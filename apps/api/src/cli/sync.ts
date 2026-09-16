/** Dispara uma sincronização pela linha de comando: node dist/cli/sync.js [catalog|incremental|history] */
import { one, pool } from '../db/pool.js';
import { closeRedis } from '../lib/cache.js';
import { runSync, type SyncKind } from '../modules/integration/sync-service.js';

const kind = (process.argv[2] as SyncKind) ?? 'incremental';

async function main() {
  const org = await one<{ id: string; name: string }>(
    `SELECT id, name FROM organizations ORDER BY created_at LIMIT 1`,
  );
  if (!org) throw new Error('Nenhuma organização encontrada. Suba a API ao menos uma vez.');

  console.log(`Sincronizando "${org.name}" (${kind})...`);
  const result = await runSync({ organizationId: org.id, kind, triggerSource: 'api' });
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
