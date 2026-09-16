/**
 * Worker de tarefas agendadas: sincronização periódica com a Track7
 * e manutenção das partições mensais.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { env } from './env.js';
import { rows, pool, waitForDatabase } from './db/pool.js';
import { ensurePartitions } from './db/migrate.js';
import { closeRedis } from './lib/cache.js';
import { runSync } from './modules/integration/sync-service.js';

interface ScheduleRow {
  organization_id: string;
  sync_cron: string;
  sync_enabled: boolean;
}

const tasks = new Map<string, { cronExpression: string; task: ScheduledTask }>();

function log(message: string, extra?: unknown): void {
  const stamp = new Date().toISOString();
  if (extra !== undefined) console.log(`[worker ${stamp}] ${message}`, extra);
  else console.log(`[worker ${stamp}] ${message}`);
}

async function refreshSchedules(): Promise<void> {
  const schedules = await rows<ScheduleRow>(
    `SELECT organization_id, sync_cron, sync_enabled
       FROM integration_credentials
      WHERE provider = 'track7'
        AND client_id_enc IS NOT NULL`,
  );

  const seen = new Set<string>();

  for (const schedule of schedules) {
    seen.add(schedule.organization_id);
    const existing = tasks.get(schedule.organization_id);

    if (!schedule.sync_enabled) {
      if (existing) {
        existing.task.stop();
        tasks.delete(schedule.organization_id);
        log(`sincronização desativada para a organização ${schedule.organization_id}`);
      }
      continue;
    }

    if (existing && existing.cronExpression === schedule.sync_cron) continue;
    if (existing) existing.task.stop();

    if (!cron.validate(schedule.sync_cron)) {
      log(`expressão cron inválida (${schedule.sync_cron}) — organização ${schedule.organization_id}`);
      continue;
    }

    const task = cron.schedule(
      schedule.sync_cron,
      () => {
        log(`iniciando sincronização agendada — organização ${schedule.organization_id}`);
        void runSync({
          organizationId: schedule.organization_id,
          kind: 'incremental',
          triggerSource: 'schedule',
        })
          .then((result) => log(`sincronização ${result.status}`, result.stats))
          .catch((err) => log('falha na sincronização agendada', (err as Error).message));
      },
      { timezone: env.TZ },
    );

    tasks.set(schedule.organization_id, { cronExpression: schedule.sync_cron, task });
    log(`agendamento ativo (${schedule.sync_cron}) — organização ${schedule.organization_id}`);
  }

  for (const [organizationId, entry] of tasks) {
    if (!seen.has(organizationId)) {
      entry.task.stop();
      tasks.delete(organizationId);
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  log('worker iniciado');

  await refreshSchedules();
  // relê a configuração a cada minuto — mudanças na UI entram em vigor sozinhas
  cron.schedule('* * * * *', () => void refreshSchedules().catch((err) => log('erro ao reler agendamentos', err)));
  // manutenção diária das partições
  cron.schedule('0 3 * * *', () => void ensurePartitions().catch((err) => log('erro ao criar partições', err)), {
    timezone: env.TZ,
  });

  const shutdown = async () => {
    log('encerrando worker...');
    for (const { task } of tasks.values()) task.stop();
    await pool.end().catch(() => {});
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
