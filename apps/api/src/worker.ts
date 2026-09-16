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
  operator_id: string;
  operator_name: string;
  sync_cron: string;
  sync_enabled: boolean;
  stream_enabled: boolean;
  stream_interval_seconds: number;
}

const tasks = new Map<string, { cronExpression: string; task: ScheduledTask }>();
interface StreamEntry {
  intervalSeconds: number;
  timer: NodeJS.Timeout | null;
  startTimer: NodeJS.Timeout | null;
  running: boolean;
}

const streams = new Map<string, StreamEntry>();

function log(message: string, extra?: unknown): void {
  const stamp = new Date().toISOString();
  if (extra !== undefined) console.log(`[worker ${stamp}] ${message}`, extra);
  else console.log(`[worker ${stamp}] ${message}`);
}

async function refreshSchedules(): Promise<void> {
  // Uma operadora entra no ar quando tem credencial própria OU quando a conta
  // tem credencial compartilhada — neste caso ela precisa estar vinculada a uma
  // organização da Track7, senão não dá para saber quais dados são dela.
  const schedules = await rows<ScheduleRow>(
    `SELECT op.organization_id,
            op.id   AS operator_id,
            op.name AS operator_name,
            c.sync_cron, c.sync_enabled, c.stream_enabled, c.stream_interval_seconds
       FROM operators op
       JOIN LATERAL (
         SELECT *
           FROM integration_credentials ic
          WHERE ic.provider = 'track7'
            AND ic.client_id_enc IS NOT NULL
            AND (ic.operator_id = op.id
                 OR (ic.operator_id IS NULL AND ic.organization_id = op.organization_id))
          ORDER BY (ic.operator_id IS NULL)  -- credencial própria tem precedência
          LIMIT 1
       ) c ON true
      WHERE op.status = 'ACTIVE'
        AND (c.operator_id IS NOT NULL OR op.track7_organisation_id IS NOT NULL)`,
  );

  const seen = new Set<string>();

  for (const [index, schedule] of schedules.entries()) {
    seen.add(schedule.operator_id);
    applyStreamCollector(schedule, index, schedules.length);
    const existing = tasks.get(schedule.operator_id);

    if (!schedule.sync_enabled) {
      if (existing) {
        existing.task.stop();
        tasks.delete(schedule.operator_id);
        log(`sincronização desativada — operadora ${schedule.operator_name}`);
      }
      continue;
    }

    if (existing && existing.cronExpression === schedule.sync_cron) continue;
    if (existing) existing.task.stop();

    if (!cron.validate(schedule.sync_cron)) {
      log(`expressão cron inválida (${schedule.sync_cron}) — operadora ${schedule.operator_name}`);
      continue;
    }

    const task = cron.schedule(
      schedule.sync_cron,
      () => {
        log(`iniciando sincronização agendada — operadora ${schedule.operator_name}`);
        void runSync({
          organizationId: schedule.organization_id,
          operatorId: schedule.operator_id,
          kind: 'incremental',
          triggerSource: 'schedule',
        })
          .then((result) => log(`sincronização ${result.status}`, result.stats))
          .catch((err) => log('falha na sincronização agendada', (err as Error).message));
      },
      { timezone: env.TZ },
    );

    tasks.set(schedule.operator_id, { cronExpression: schedule.sync_cron, task });
    log(`agendamento ativo (${schedule.sync_cron}) — operadora ${schedule.operator_name}`);
  }

  for (const [operatorId, entry] of tasks) {
    if (!seen.has(operatorId)) {
      entry.task.stop();
      tasks.delete(operatorId);
    }
  }
  for (const [operatorId, entry] of streams) {
    if (!seen.has(operatorId)) {
      stopStream(entry);
      streams.delete(operatorId);
    }
  }
}

function stopStream(entry: StreamEntry): void {
  if (entry.timer) clearInterval(entry.timer);
  if (entry.startTimer) clearTimeout(entry.startTimer);
}

/**
 * Liga (ou reconfigura) o coletor contínuo de posições da organização.
 * O ciclo nunca se sobrepõe: se o anterior ainda roda, este é pulado.
 */
function applyStreamCollector(schedule: ScheduleRow, index: number, total: number): void {
  const { organization_id: organizationId, operator_id: operatorId, operator_name: operatorName } = schedule;
  const intervalSeconds = Math.max(10, schedule.stream_interval_seconds ?? 30);
  const existing = streams.get(operatorId);

  if (!schedule.stream_enabled) {
    if (existing) {
      stopStream(existing);
      streams.delete(operatorId);
      log(`coletor de posições desativado — operadora ${operatorName}`);
    }
    return;
  }

  if (existing && existing.intervalSeconds === intervalSeconds) return;
  if (existing) stopStream(existing);

  const runCycle = () => {
    const current = streams.get(operatorId);
    if (!current || current.running) return; // ciclo anterior ainda em andamento
    current.running = true;
    void collectPositions(organizationId, operatorId)
      .then((result) => {
        if (result.skipped) return; // ainda não pronto: nada a registrar
        if (result.gapDetected) {
          log(`lacuna no histórico — operadora ${operatorName}: rode um backfill`);
        }
        if (result.collected > 0) {
          log(`${operatorName}: ${result.collected} posição(ões) em ${result.pages} página(s) (${result.durationMs} ms)`);
        }
      })
      .catch((err) => log(`falha no coletor — operadora ${operatorName}: ${(err as Error).message}`))
      .finally(() => {
        const c = streams.get(operatorId);
        if (c) c.running = false;
      });
  };

  // Distribui os coletores dentro do intervalo: com dezenas de operadoras,
  // disparar todas no mesmo segundo criaria picos na API. A defasagem entra
  // antes de iniciar o intervalo, para que os ciclos sigam espaçados.
  const jitterMs = total > 1 ? Math.round((index / total) * intervalSeconds * 1000) : 0;

  const entry: StreamEntry = {
    intervalSeconds,
    running: false,
    timer: null,
    startTimer: setTimeout(() => {
      runCycle();
      const current = streams.get(operatorId);
      if (current) current.timer = setInterval(runCycle, intervalSeconds * 1000);
    }, jitterMs),
  };
  streams.set(operatorId, entry);

  log(
    `coletor ativo (a cada ${intervalSeconds}s, defasagem ${(jitterMs / 1000).toFixed(1)}s) — operadora ${operatorName}`,
  );
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
    for (const entry of streams.values()) stopStream(entry);
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
