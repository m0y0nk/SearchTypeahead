import { pool } from './database';
import { cacheManager } from './cache';

interface BatchEntry {
  count: number;
  last_searched_at: Date;
}

export class BatchWriter {
  private buffer: Map<string, BatchEntry> = new Map();
  private flushIntervalMs: number;
  private maxBatchSize: number;
  private flushTimer: NodeJS.Timeout | null = null;
  public totalWritesAvoided: number = 0;
  private isFlushing: boolean = false;

  constructor(flushIntervalMs: number = 5000, maxBatchSize: number = 100) {
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this.startTimer();
  }

  private startTimer() {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  public stopTimer() {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  public getQueueSize() {
    return this.buffer.size;
  }

  public getPendingSuggestions(prefix: string): { query: string, count: number }[] {
    const matches: { query: string, count: number }[] = [];
    for (const [query, entry] of this.buffer.entries()) {
      if (query.startsWith(prefix)) {
        matches.push({ query, count: entry.count });
      }
    }
    return matches;
  }

  public recordSearch(query: string) {
    // Normalize query
    query = query.toLowerCase().trim();
    if (!query) return;

    const now = new Date();
    if (this.buffer.has(query)) {
      const entry = this.buffer.get(query)!;
      entry.count += 1;
      entry.last_searched_at = now;
      this.totalWritesAvoided += 1; // Counted as an avoided DB write since we batch it
    } else {
      this.buffer.set(query, { count: 1, last_searched_at: now });
    }

    // Invalidate cache immediately for real-time responsiveness
    const maxPrefixLen = Math.min(query.length, 15);
    for (let i = 3; i <= maxPrefixLen; i++) {
      const prefix = query.substring(0, i);
      cacheManager.invalidatePrefix(prefix).catch(err => console.error(err));
    }

    if (this.buffer.size >= this.maxBatchSize) {
      this.flush();
    }
  }

  public async flush() {
    if (this.buffer.size === 0 || this.isFlushing) return;
    this.isFlushing = true;

    // Snapshot buffer and clear
    const snapshot = new Map(this.buffer);
    this.buffer.clear();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Decay half-life configuration (e.g. 7 days)
      const HALF_LIFE_DAYS = 7;
      const LAMBDA = Math.LN2 / (HALF_LIFE_DAYS * 24 * 3600);

      // Perform bulk upsert
      for (const [query, entry] of snapshot.entries()) {
        const insertQuery = `
          INSERT INTO queries (query, all_time_count, decayed_score, last_searched_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (query) DO UPDATE SET
            all_time_count = queries.all_time_count + EXCLUDED.all_time_count,
            decayed_score = (queries.decayed_score * EXP(-$5 * EXTRACT(EPOCH FROM (EXCLUDED.last_searched_at - queries.last_searched_at)))) + EXCLUDED.decayed_score,
            last_searched_at = EXCLUDED.last_searched_at;
        `;
        
        // Excluded decayed score is roughly equal to entry.count if searches were close in time.
        // We approximate multiple searches in this batch simply as entry.count.
        const batchDecayedScore = entry.count;
        
        await client.query(insertQuery, [
          query,
          entry.count,
          batchDecayedScore,
          entry.last_searched_at,
          LAMBDA
        ]);
      }

      await client.query('COMMIT');
      console.log(`Flushed ${snapshot.size} unique queries to PostgreSQL.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error flushing batch to DB:', err);
      // Optional: push back to buffer if needed, ignoring for MVP
    } finally {
      client.release();
      this.isFlushing = false;
    }
  }
}

export const batchWriter = new BatchWriter(5000, 1000); // Flush every 5s or 1000 items
