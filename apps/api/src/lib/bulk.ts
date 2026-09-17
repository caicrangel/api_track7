import type { PoolClient } from 'pg';

const MAX_BIND_PARAMS = 60_000;

/**
 * INSERT ... ON CONFLICT DO UPDATE em lote, com chunking automático para
 * respeitar o limite de parâmetros do protocolo do Postgres.
 */
export async function bulkUpsert(
  client: PoolClient,
  table: string,
  columns: string[],
  values: unknown[][],
  conflictColumns: string[],
  updateColumns: string[],
): Promise<number> {
  if (values.length === 0) return 0;
  const chunkSize = Math.max(1, Math.floor(MAX_BIND_PARAMS / columns.length));
  let affected = 0;

  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map((_, rowIndex) => {
        const base = rowIndex * columns.length;
        return `(${columns.map((_, colIndex) => `$${base + colIndex + 1}`).join(',')})`;
      })
      .join(',');

    const updates = updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    const sql =
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ` +
      `ON CONFLICT (${conflictColumns.join(',')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`;

    const result = await client.query(sql, chunk.flat());
    affected += result.rowCount ?? 0;
  }
  return affected;
}

/** Divide um array em blocos de tamanho fixo. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
