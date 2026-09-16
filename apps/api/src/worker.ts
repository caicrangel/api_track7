/**
 * Worker de tarefas de fundo:
 *   · coletor contínuo de posições (padrão: a cada 30 s) — é ele que constrói
 *     o histórico de GPS usado no relatório georreferenciado da SMMUR/SUMOB;
 *   · sincronização periódica de catálogo, viagens e eventos;
 *   · manutenção das partições mensais.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { env } from './env.js';
import { rows, pool, waitForDatabase } from './db/pool.js';
import { ensurePartitions } from './db/migrate.js';
import { closeRedis } from './lib/cache.js';
import { runSync } from './modules/integration/sync-service.js';
import { collectPositions } from './modules/integration/position-stream.js';

interface ScheduleRow {
  organization_id: string;
  sync_cron: string;
  sync_enabled: boolean;
  stream_enabled: boolean;
  stream_interval_seconds: number;
}

const tasks = new Map<string, { cronExpression: string; task: ScheduledTask }>();
const streams = new Map<string, { intervalSeconds: number; timer: NodeJS.Timeout; running: boolean }>();

function log(message: string, extra?: unknown): void {
  const stamp = new Date().toISOString();
  if (extra !== undefined) console.log(`[worker ${stamp}] ${message}`, extra);
  else console.log(`[worker ${stamp}] ${message}`);
}

async function refreshSchedules(): Promise<void> {
  const schedules = await rows<ScheduleRow>(
    `SELECT organization_id, sync_cron, sync_enabled, stream_enabled, stream_interval_seconds
       FROM integration_credentials
      WHERE provider = 'track7'
        AND client_id_enc IS NOT NULL`,
  );

  const seen = new Set<string>();

  for (const schedule of schedules) {
    seen.add(schedule.organization_id);
    applyStreamCollector(schedule);
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
  for (const [organizationId, entry] of streams) {
    if (!seen.has(organizationId)) {
      clearInterval(entry.timer);
      streams.delete(organizationId);
    }
  }
}

/**
 * Liga (ou reconfigura) o coletor contínuo de posições da organização.
 * O ciclo nunca se sobrepõe: se o anterior ainda roda, este é pulado.
 */
function applyStreamCollector(schedule: ScheduleRow): void {
  const organizationId = schedule.organization_id;
  const intervalSeconds = Math.max(10, schedule.stream_interval_seconds ?? 30);
  const existing = streams.get(organizationId);

  if (!schedule.stream_enabled) {
    if (existing) {
      clearInterval(existing.timer);
      streams.delete(organizationId);
      log(`coletor de posições desativado — organização ${organizationId}`);
    }
    return;
  }

  if (existing && existing.intervalSeconds === intervalSeconds) return;
  if (existing) clearInterval(existing.timer);

  const entry = {
    intervalSeconds,
    running: false,
    timer: setInterval(() => {
      const current = streams.get(organizationId);
      if (!current || current.running) return; // ciclo anterior ainda em andamento
      current.running = true;
      void collectPositions(organizationId)
        .then((result) => {
          if (result.gapDetected) {
            log(`lacuna detectada no histórico — organização ${organizationId}: rode um backfill`);
          }
          if (result.collected > 0) {
            log(`posições coletadas: ${result.collected} em ${result.pages} página(s) (${result.durationMs} ms)`);
          }
        })
        .catch((err) => log(`falha no coletor de posições: ${(err as Error).message}`))
        .finally(() => {
          const c = streams.get(organizationId);
          if (c) c.running = false;
        });
    }, intervalSeconds * 1000),
  };

  streams.set(organizationId, entry);
  log(`coletor de posições ativo (a cada ${intervalSeconds}s) — organização ${organizationId}`);
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
    for (const { timer } of streams.values()) clearInterval(timer);
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
