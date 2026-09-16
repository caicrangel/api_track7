import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, waitForDatabase } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

export async function runMigrations(log: (msg: string) => void = console.log): Promise<void> {
  await waitForDatabase();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`[migrate] aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  log('[migrate] banco atualizado');
}

/** Garante partições mensais das tabelas particionadas (chamado no boot e diariamente). */
export async function ensurePartitions(): Promise<void> {
  await pool.query(
    `SELECT ensure_month_partitions('positions', (date_trunc('month', now()) - interval '1 month')::date, 14)`,
  );
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
