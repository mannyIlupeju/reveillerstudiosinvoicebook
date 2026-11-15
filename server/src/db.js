import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// bigint (int8) columns hold cents; values stay well inside JS's safe integer range.
pg.types.setTypeParser(20, (v) => Number(v));

const ssl = process.env.DATABASE_SSL === 'false' || !/sslmode=|render\.com/.test(process.env.DATABASE_URL || '')
  ? undefined
  : { rejectUnauthorized: false };
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });

export const newId = () => crypto.randomUUID();

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const mapRow = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) : row);

// Run a query on the pool or on a transaction client. Returns camelCased rows.
export async function q(sql, params = [], client = pool) {
  const res = await client.query(sql, params);
  return res.rows.map(mapRow);
}
export async function one(sql, params = [], client = pool) {
  return (await q(sql, params, client))[0] || null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Apply any SQL files in /migrations that haven't run yet. An advisory lock keeps
// two starting instances from migrating at the same time.
export async function migrate() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727272)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`migrated ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727272)').catch(() => {});
    client.release();
  }
}

// Unique-violation check for idempotent inserts.
export const isUniqueViolation = (e) => e?.code === '23505';
