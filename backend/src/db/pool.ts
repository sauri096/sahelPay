import { Pool, PoolClient, types } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

// BIGINT (int8) -> number. Les montants en FCFA restent largement sous 2^53.
types.setTypeParser(20, (v) => Number(v));

export const pool = new Pool({ connectionString: config.databaseUrl });

export type Db = Pool | PoolClient;

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate(db: Db = pool): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
}
