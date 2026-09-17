import pg from 'pg';
import { env } from '../env.js';

const { Pool, types } = pg;

// numeric (OID 1700) chega como string por padrão; converte para number
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

// int8 (OID 20) guarda os identificadores da Track7, que passam de 2^53 — a
// organização do consórcio é um deles. Convertidos para number perdem dígitos
// em silêncio: 1709358234985169000 vira 1709358234985168896, e a API devolve
// 401 para um id que nunca existiu. Acima do limite seguro devolvemos a string
// exata; abaixo segue number, que é o que contadores e horímetro esperam.
const int8 = (v: string | null) => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
};
types.setTypeParser(20, int8);
// 1016 = bigint[]; o tipo exportado pelo pg não lista os OIDs de array.
(types.setTypeParser as unknown as (oid: number, fn: (v: string) => unknown) => void)(
  1016,
  (v) => (v === null ? null : parseBigIntArray(v)),
);

function parseBigIntArray(raw: string): Array<number | string | null> {
  const inner = raw.replace(/^\{|\}$/g, '');
  if (!inner) return [];
  // elemento nulo sai do Postgres como NULL sem aspas
  return inner.split(',').map((item) => (item === 'NULL' ? null : int8(item)));
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: `fleetgov-${env.ROLE}`,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] erro inesperado no pool', err);
});

export type QueryParams = ReadonlyArray<unknown>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

export async function rows<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T | null> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows[0] ?? null;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

// Erros que nenhuma espera resolve: o banco respondeu e recusou. Repetir só
// atrasa a falha e esconde a causa atrás de um stack trace de timeout.
const FATAL_DB_CODES: Record<string, string> = {
  '28P01': 'senha recusada. A senha em DATABASE_URL precisa ser idêntica a POSTGRES_PASSWORD no .env. ' +
    'Se as duas já batem, o volume do Postgres foi inicializado com uma senha antiga — ' +
    'POSTGRES_PASSWORD só vale na primeira criação do volume. Recrie com: docker compose down -v && docker compose up -d',
  '28000': 'usuário recusado. Confira POSTGRES_USER no .env e o usuário em DATABASE_URL.',
  '3D000': 'banco inexistente. Confira POSTGRES_DB no .env e o nome do banco em DATABASE_URL.',
};

export async function waitForDatabase(retries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      const fatal = FATAL_DB_CODES[code];
      if (fatal) throw new Error(`Conexão com o banco recusada (${code}): ${fatal}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
