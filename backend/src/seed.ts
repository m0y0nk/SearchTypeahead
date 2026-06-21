import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { pool } from './database';

const DATA_FILE = path.resolve(__dirname, '../../data/user-ct-test-collection-02.txt');

// Config parameters
const MIN_COUNT_TO_SEED = 2; // Filter out 1-off typos
const HALF_LIFE_DAYS = 7;
const LAMBDA = Math.LN2 / (HALF_LIFE_DAYS * 24 * 3600);

interface QueryData {
  count: number;
  timestamps: number[]; // Store epoch times (seconds)
}

async function runSeed() {
  const BAD_WORDS = [
    'porn', 'sex', 'lolita', 'mature', 'vagina', 'naked', 'erotic', 'xxx', 'teen', 
    'teenfuns', 'amateursexhunters', 'drunkenmature', 'cherryteenthumbs', 'penis', 
    'boobs', 'adult', 'fetish', 'milf', 'hentai', 'playboy', 'vulgar', 'orgasm', 
    'masturbat', 'clitoris', 'anal', 'lesbian', 'gay', 'escort', 'whore', 'slut', 
    'prostitute', 'wetcircle', 'jizzhut', 'makehimsuffer', 'makehimpay'
  ];
  
  const isProfane = (query: string) => {
    return BAD_WORDS.some(word => query.includes(word));
  };
  console.log(`Starting data ingestion from ${DATA_FILE}...`);
  if (!fs.existsSync(DATA_FILE)) {
    console.error('Data file not found!');
    process.exit(1);
  }

  const queryMap = new Map<string, QueryData>();

  const fileStream = fs.createReadStream(DATA_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let validCount = 0;
  let explicitFiltered = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue; // Skip header

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const rawQuery = parts[1];
    const timeStr = parts[2];
    
    if (!rawQuery || !timeStr) continue;

    const query = rawQuery.toLowerCase().trim();
    // Basic validation: length, only punctuation, etc.
    if (query.length < 2 || query.length > 255 || !/[a-z0-9]/.test(query)) continue;

    // Profanity Filter Check
    if (isProfane(query)) {
      explicitFiltered++;
      continue;
    }

    const timestamp = new Date(timeStr).getTime() / 1000;

    if (!queryMap.has(query)) {
      queryMap.set(query, { count: 0, timestamps: [] });
    }
    
    const entry = queryMap.get(query)!;
    entry.count++;
    entry.timestamps.push(timestamp);
    
    validCount++;
    if (lineCount % 500000 === 0) {
      console.log(`Processed ${lineCount} lines... Unique queries so far: ${queryMap.size}`);
    }
  }

  console.log(`Finished reading file. Total lines: ${lineCount}`);
  console.log(`Valid searches: ${validCount}`);
  console.log(`Explicit queries filtered: ${explicitFiltered}`);
  console.log(`Total unique queries: ${queryMap.size}`);

  console.log(`Filtering queries with count >= ${MIN_COUNT_TO_SEED} and calculating decay scores...`);
  
  const entriesToInsert = [];
  
  for (const [query, data] of queryMap.entries()) {
    if (data.count < MIN_COUNT_TO_SEED) continue;

    // Sort timestamps chronologically
    data.timestamps.sort((a, b) => a - b);
    
    let decayedScore = 0;
    let lastTime = data.timestamps[0];

    for (const t of data.timestamps) {
      const timeDiff = t - lastTime;
      decayedScore = decayedScore * Math.exp(-LAMBDA * timeDiff) + 1;
      lastTime = t;
    }

    entriesToInsert.push({
      query,
      allTimeCount: data.count,
      decayedScore,
      lastSearchedAt: new Date(lastTime * 1000).toISOString()
    });
  }

  console.log(`Queries to seed: ${entriesToInsert.length}`);
  
  const client = await pool.connect();
  try {
    // Truncate existing data
    await client.query('TRUNCATE TABLE queries');

    // Bulk insert in batches
    const BATCH_SIZE = 5000;
    for (let i = 0; i < entriesToInsert.length; i += BATCH_SIZE) {
      const batch = entriesToInsert.slice(i, i + BATCH_SIZE);
      let queryStr = 'INSERT INTO queries (query, all_time_count, decayed_score, last_searched_at) VALUES ';
      const values: any[] = [];
      let valIndex = 1;

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        queryStr += `($${valIndex++}, $${valIndex++}, $${valIndex++}, $${valIndex++})`;
        if (j < batch.length - 1) queryStr += ', ';
        
        values.push(item.query, item.allTimeCount, item.decayedScore, item.lastSearchedAt);
      }

      await client.query(queryStr, values);
      if ((i + BATCH_SIZE) % 50000 === 0) {
        console.log(`Inserted ${Math.min(i + BATCH_SIZE, entriesToInsert.length)} queries...`);
      }
    }
    
    console.log('Database seeding complete!');
  } catch (err) {
    console.error('Error during seeding:', err);
  } finally {
    client.release();
    pool.end();
  }
}

runSeed().catch(console.error);
