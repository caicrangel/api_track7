/**
 * Dispara uma sincronização pela linha de comando:
 *   node dist/cli/sync.js [catalog|incremental|history] [nome-ou-id-da-operadora]
 */
import { one, pool } from '../db/pool.js';
import { closeRedis } from '../lib/cache.js';
import { runSync, type SyncKind } from '../modules/integration/sync-service.js';

const kind = (process.argv[2] as SyncKind) ?? 'incremental';

async function main() {
  const operator = await one<{ id: string; organization_id: string; name: string }>(
    `SELECT id, organization_id, name FROM operators
      WHERE ($1::text IS NULL OR lower(name) = lower($1) OR id::text = $1)
      ORDER BY created_at LIMIT 1`,
    [process.argv[3] ?? null],
  );
  if (!operator) throw new Error('Nenhuma empresa operadora encontrada. Suba a API ao menos uma vez.');

  console.log(`Sincronizando "${operator.name}" (${kind})...`);
  const result = await runSync({
    organizationId: operator.organization_id,
    operatorId: operator.id,
    kind,
    triggerSource: 'api',
  });
  console.log(`Status: ${result.status} em ${result.durationMs} ms`);
  console.table(result.steps);
  if (result.error) console.error(`Erro: ${result.error}`);
  process.exitCode = result.status === 'ERROR' ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    await closeRedis();
  });
