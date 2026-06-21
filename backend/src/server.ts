import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { initDB, pool } from './database';
import { cacheManager } from './cache';
import { batchWriter } from './batcher';
import { AlgorithmType } from './types';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Analytics tracking
const metrics = {
  totalRequests: 0,
  cacheHits: 0,
  totalLatencyMs: 0,
  dbReads: 0,
  latencies: [] as number[],
};

app.get('/api/suggest', async (req: Request, res: Response) => {
  const start = Date.now();
  metrics.totalRequests++;

  const prefix = (req.query.q as string || '').toLowerCase().trim();
  const algorithm = (req.query.algorithm as AlgorithmType) || 'basic';

  if (prefix.length < 3) {
    return res.json([]);
  }

  try {
    // 1. Check Distributed Cache
    const { suggestions, isHit, ringInfo } = await cacheManager.getSuggestions(prefix, algorithm);
    
    if (isHit && suggestions) {
      metrics.cacheHits++;
      const latency = Date.now() - start;
      metrics.totalLatencyMs += latency;
      metrics.latencies.push(latency);
      return res.json(suggestions);
    }

    // 2. Cache Miss - Query Database
    metrics.dbReads++;
    let dbQuery = '';
    if (algorithm === 'basic') {
      dbQuery = `
        SELECT query, all_time_count 
        FROM queries 
        WHERE query LIKE $1 
        ORDER BY all_time_count DESC 
        LIMIT 10;
      `;
    } else {
      dbQuery = `
        SELECT query, decayed_score 
        FROM queries 
        WHERE query LIKE $1 
        ORDER BY decayed_score DESC 
        LIMIT 10;
      `;
    }

    const { rows } = await pool.query(dbQuery, [`${prefix}%`]);
    const results = rows.map(r => ({
      query: r.query,
      all_time_count: r.all_time_count,
      decayed_score: r.decayed_score
    }));

    // 3. Update Cache
    await cacheManager.setSuggestions(prefix, algorithm, results, 60);

    const latency = Date.now() - start;
    metrics.totalLatencyMs += latency;
    metrics.latencies.push(latency);
    return res.json(results);
  } catch (err) {
    console.error('Suggest API Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/search', (req: Request, res: Response) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Queue into batch buffer
  batchWriter.recordSearch(query);

  res.json({ message: 'Searched', query });
});

app.get('/api/cache/debug', async (req: Request, res: Response) => {
  const prefix = (req.query.prefix as string || '').toLowerCase().trim();
  const algorithm = (req.query.algorithm as AlgorithmType) || 'basic';
  if (!prefix) {
    return res.status(400).json({ error: 'Prefix is required' });
  }

  const debugInfo = await cacheManager.getDebugInfo(prefix, algorithm);
  res.json(debugInfo);
});

app.get('/api/analytics', (req: Request, res: Response) => {
  // Calculate P95
  let p95LatencyMs = '0';
  if (metrics.latencies.length > 0) {
    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    p95LatencyMs = sorted[p95Index].toFixed(2);
  }

  res.json({
    totalRequests: metrics.totalRequests,
    cacheHits: metrics.cacheHits,
    hitRate: metrics.totalRequests > 0 ? ((metrics.cacheHits / metrics.totalRequests) * 100).toFixed(2) + '%' : '0%',
    averageLatencyMs: metrics.totalRequests > 0 ? (metrics.totalLatencyMs / metrics.totalRequests).toFixed(2) : '0',
    p95LatencyMs,
    dbReads: metrics.dbReads,
    dbWritesAvoided: batchWriter.totalWritesAvoided,
    batchQueueSize: batchWriter.getQueueSize(),
    recentLatencies: metrics.latencies.slice(-10),
  });
});

app.get('/api/trending', async (req: Request, res: Response) => {
  const algorithm = (req.query.algorithm as AlgorithmType) || 'basic';
  try {
    const orderBy = algorithm === 'basic' ? 'all_time_count' : 'decayed_score';
    const { rows } = await pool.query(`
      SELECT query, all_time_count, decayed_score 
      FROM queries 
      ORDER BY ${orderBy} DESC 
      LIMIT 10;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Trending API Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initDB();
  await cacheManager.connect();
  app.listen(PORT, () => {
    console.log(`Typeahead backend listening on port ${PORT}`);
  });
}

startServer();
