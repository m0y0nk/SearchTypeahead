import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'typeahead',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'typeahead',
});

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS queries (
          query VARCHAR(255) PRIMARY KEY,
          all_time_count INT NOT NULL DEFAULT 0,
          decayed_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
          last_searched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create indexes. Using IF NOT EXISTS requires Postgres 9.5+.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_queries_prefix ON queries (query varchar_pattern_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_queries_decayed_score ON queries (decayed_score DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_queries_all_time_count ON queries (all_time_count DESC);
    `);

    console.log('Database schema initialized.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}
