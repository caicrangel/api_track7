/**
 * Coletor contínuo de posições da Track7.
 *
 * A API entrega as posições novas a partir de um ponteiro (`sinceToken`),
 * pelo endpoint indicado pelo suporte da Track7:
 *
 *   GET api/positions/groups/createdsince/organisation/{organisationId}
 *       /sincetoken/{sinceToken}/quantity/{quantity}
 *
 * A cada ciclo (30 s por padrão) o coletor drena a fila enquanto o cabeçalho
 * `HasMoreItems` for true e guarda o `GetSinceToken` devolvido. O ponteiro fica
 * no banco (`stream_cursors`) para sobreviver a reinícios — é ele que garante
 * que o histórico de GPS não tenha buracos.
 *
 * Este histórico é a matéria-prima do relatório georreferenciado exigido pela
 * SMMUR/SUMOB: número de ordem, data, hora, latitude e longitude por viagem.
 *
 * Cada empresa operadora tem o próprio ponteiro e o próprio coletor.
 */
import { one, query } from '../../db/pool.js';
import { acquireLock } from '../../lib/cache.js';
import { buildClient } from './credentials.js';
import { upsertPositions } from './sync-service.js';
import { SINCE_TOKEN_MAX_AGE_MS, toSinceToken } from './track7-client.js';

/** Teto de páginas por ciclo — evita que um backlog grande prenda o coletor. */
const MAX_PAGES_PER_CYCLE = 50;

/** Margem de segurança sobre o limite de 7 dias do token. */
const TOKEN_SAFETY_MARGIN_MS = 12 * 3600_000;

export interface StreamCursor {
  organization_id: string;
  operator_id: string;
  since_token: string | null;
  token_updated_at: Date | null;
  last_run_at: Date | null;
  last_count: number;
  total_collected: number;
  consecutive_errors: number;
  last_error: string | null;
  last_gap_from: Date | null;
  last_gap_to: Date | null;
}

export interface CollectResult {
  collected: number;
  pages: number;
  hasMoreItems: boolean;
  sinceToken: string | null;
  gapDetected: boolean;
  durationMs: number;
  /** Motivo de não ter coletado nada — ausente quando o ciclo rodou. */
  skipped?: string;
}

export async function getCursor(operatorId: string): Promise<StreamCursor | null> {
  return one<StreamCursor>(
    `SELECT * FROM stream_cursors
      WHERE operator_id = $1 AND provider = 'track7' AND stream = 'positions'`,
    [operatorId],
  );
}

/**
 * Decide com que ponteiro começar o ciclo.
 * Token ausente ou vencido (mais de ~7 dias) obriga recomeçar do presente —
 * a lacuna resultante fica registrada para ser preenchida por backfill.
 */
function resolveToken(cursor: StreamCursor | null): { token: string; gap: boolean } {
  if (!cursor?.since_token || !cursor.token_updated_at) return { token: 'NEW', gap: false };
  const age = Date.now() - new Date(cursor.token_updated_at).getTime();
  if (age > SINCE_TOKEN_MAX_AGE_MS - TOKEN_SAFETY_MARGIN_MS) {
    return { token: 'NEW', gap: true };
  }
  return { token: cursor.since_token, gap: false };
}

/**
 * Executa um ciclo do coletor: drena a fila da API e grava as posições.
 * Seguro para chamar em paralelo — um lock impede ciclos concorrentes.
 */
export async function collectPositions(
  organizationId: string,
  operatorId: string,
): Promise<CollectResult> {
  const startedAt = Date.now();
  const release = await acquireLock(`stream:${operatorId}`, 120);
  if (!release) {
    return {
      collected: 0,
      pages: 0,
      hasMoreItems: false,
      sinceToken: null,
      gapDetected: false,
      durationMs: 0,
      skipped: 'ciclo anterior ainda em andamento',
    };
  }

  try {
    const { row, client, operator } = await buildClient(operatorId);
    const organisationId = operator.track7_organisation_id;
    if (!organisationId) {
      // Não é falha: a organização é resolvida na primeira sincronização de
      // catálogo. Até lá o coletor fica de lado, sem poluir o log.
      return {
        collected: 0,
        pages: 0,
        hasMoreItems: false,
        sinceToken: null,
        gapDetected: false,
        durationMs: Date.now() - startedAt,
        skipped: 'organização da Track7 ainda não identificada — aguardando a primeira sincronização de catálogo',
      };
    }

    const cursor = await getCursor(operatorId);
    const { token: startToken, gap } = resolveToken(cursor);

    if (gap && cursor?.token_updated_at) {
      // registra a lacuna: o período entre o último token e agora precisa de backfill
      await query(
        `UPDATE stream_cursors
            SET last_gap_from = $2, last_gap_to = now(), updated_at = now()
          WHERE operator_id = $1 AND provider = 'track7' AND stream = 'positions'`,
        [operatorId, cursor.token_updated_at],
      );
    }

    let token = startToken;
    let collected = 0;
    let pages = 0;
    let hasMoreItems = false;

    do {
      const result = await client.getPositionsCreatedSinceForOrganisation(
        organisationId,
        token,
        row.stream_quantity ?? 1000,
      );
      pages += 1;
      hasMoreItems = result.hasMoreItems;

      if (result.items.length) {
        collected += await upsertPositions(organizationId, operatorId, result.items, true);
      }

      // sem token novo não dá para avançar: mantém o anterior e sai
      if (!result.nextSinceToken) break;
      token = result.nextSinceToken;
    } while (hasMoreItems && pages < MAX_PAGES_PER_CYCLE);

    await saveCursor(organizationId, operatorId, token, collected, null);

    return {
      collected,
      pages,
      hasMoreItems,
      sinceToken: token,
      gapDetected: gap,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    await saveCursor(organizationId, operatorId, null, 0, (err as Error).message);
    throw err;
  } finally {
    await release();
  }
}

async function saveCursor(
  organizationId: string,
  operatorId: string,
  token: string | null,
  count: number,
  error: string | null,
): Promise<void> {
  if (error) {
    await query(
      `INSERT INTO stream_cursors (organization_id, operator_id, provider, stream, consecutive_errors, last_error, last_run_at, updated_at)
       VALUES ($1,$2,'track7','positions',1,$3, now(), now())
       ON CONFLICT (operator_id, provider, stream) DO UPDATE SET
         consecutive_errors = stream_cursors.consecutive_errors + 1,
         last_error = EXCLUDED.last_error,
         last_run_at = now(),
         updated_at = now()`,
      [organizationId, operatorId, error],
    );
    return;
  }

  await query(
    `INSERT INTO stream_cursors
       (organization_id, operator_id, provider, stream, since_token, token_updated_at,
        last_run_at, last_count, total_collected, consecutive_errors, last_error, updated_at)
     VALUES ($1,$2,'track7','positions',$3, now(), now(), $4, $5, 0, NULL, now())
     ON CONFLICT (operator_id, provider, stream) DO UPDATE SET
       since_token = EXCLUDED.since_token,
       token_updated_at = now(),
       last_run_at = now(),
       last_count = EXCLUDED.last_count,
       total_collected = stream_cursors.total_collected + EXCLUDED.last_count,
       consecutive_errors = 0,
       last_error = NULL,
       updated_at = now()`,
    [organizationId, operatorId, token, count, count],
  );
}

/**
 * Preenche uma lacuna do histórico usando a consulta por período
 * (`api/positions/assets/from/{from}/to/{to}`), que aceita janelas de 7 dias.
 * Usado quando o coletor ficou parado tempo demais para o token continuar válido.
 */
export async function backfillPositions(
  organizationId: string,
  operatorId: string,
  from: Date,
  to: Date,
): Promise<{ collected: number; windows: number }> {
  const { client } = await buildClient(operatorId);
  const { rows } = await import('../../db/pool.js');
  const assets = await rows<{ asset_id: number }>(
    `SELECT asset_id FROM vehicles WHERE operator_id = $1 AND status = 'ACTIVE'`,
    [operatorId],
  );
  const assetIds = assets.map((a) => Number(a.asset_id));
  if (!assetIds.length) return { collected: 0, windows: 0 };

  const { splitWindows } = await import('./track7-client.js');
  const { chunk } = await import('../../lib/bulk.js');

  let collected = 0;
  let windows = 0;
  for (const [windowStart, windowEnd] of splitWindows(from, to)) {
    windows += 1;
    for (const batch of chunk(assetIds, 50)) {
      const positions = await client.getPositionsByAssets(batch, windowStart, windowEnd);
      collected += await upsertPositions(organizationId, operatorId, positions, false);
    }
  }

  // lacuna preenchida
  await query(
    `UPDATE stream_cursors SET last_gap_from = NULL, last_gap_to = NULL, updated_at = now()
      WHERE operator_id = $1 AND provider = 'track7' AND stream = 'positions'`,
    [operatorId],
  );

  return { collected, windows };
}

/** Semeia o ponteiro a partir de um instante conhecido (ou do presente). */
export async function seedCursor(
  organizationId: string,
  operatorId: string,
  from?: Date,
): Promise<string> {
  const token = from ? toSinceToken(from) : 'NEW';
  await saveCursor(organizationId, operatorId, token, 0, null);
  return token;
}
