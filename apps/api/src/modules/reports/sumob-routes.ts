import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toCsv } from '../../lib/csv.js';
import { resolveOperator } from '../operators/operators-service.js';
import {
  dataDictionaryRows,
  decendioOf,
  extractSumobRows,
  sha256Of,
  SUMOB_COLUMNS,
  sumobFileName,
  toSumobCsv,
  toSumobXlsx,
} from './sumob-report.js';
import { zBigId } from '../../lib/big-id.js';

const extractionSchema = z.object({
  operatorId: z.string().uuid().optional(),
  assetId: zBigId(z),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const fileSchema = extractionSchema.extend({
  tripExternalId: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});

async function organizationTimezone(organizationId: string): Promise<string> {
  const row = await one<{ timezone: string }>(`SELECT timezone FROM organizations WHERE id = $1`, [
    organizationId,
  ]);
  return row?.timezone ?? 'America/Sao_Paulo';
}

export async function sumobRoutes(app: FastifyInstance): Promise<void> {
  /** Modelo e dicionário de dados — é o que vai à validação da SMMUR/SUMOB. */
  app.get('/modelo', { preHandler: authenticate }, async (request, reply) => {
    const me = currentUser(request);
    const { format } = z.object({ format: z.enum(['json', 'csv']).default('json') }).parse(request.query);

    if (format === 'csv') {
      const csv = toCsv(dataDictionaryRows() as unknown as Array<Record<string, unknown>>, [
        { key: 'ordem', label: 'Ordem' },
        { key: 'campo', label: 'Campo' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'significado', label: 'Significado' },
        { key: 'formato', label: 'Formato' },
        { key: 'exemplo', label: 'Exemplo' },
      ]);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="dicionario-de-dados-track7.csv"');
      return csv;
    }

    return {
      nome: 'Relatório Georreferenciado de Viagem — Track7',
      fornecedor: 'Track7 (plataforma MiX Telematics / On-Road IoT)',
      origem: 'Extração direta da API oficial, sem intervenção manual.',
      fusoHorario: await organizationTimezone(me.orgId),
      formatos: ['xlsx', 'csv'],
      csv: {
        separadorDeCampos: ';',
        codificacao: 'UTF-8 com BOM',
        quebraDeLinha: 'CRLF',
        separadorDecimal: '.',
      },
      ordenacao: 'Cronológica crescente pelo instante do registro.',
      nomeDoArquivo: 'ID da viagem da planilha de apuração + extensão (ex.: ID41257202604131231.xlsx).',
      colunas: SUMOB_COLUMNS,
      dicionario: dataDictionaryRows(),
    };
  });

  /** Pré-visualização: mostra os pings antes de emitir o arquivo. */
  app.post('/preview', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const body = extractionSchema.parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, body.operatorId);
    const timezone = await organizationTimezone(me.orgId);

    const extraction = await extractSumobRows({
      operatorId: operator.id,
      assetId: body.assetId,
      from: body.from,
      to: body.to,
      timezone,
      vehicleOrderField: operator.vehicle_order_field,
    });

    return {
      operador: { id: operator.id, nome: operator.name },
      veiculo: { assetId: extraction.assetId, numeroOrdem: extraction.vehicleOrder },
      periodo: { de: body.from, ate: body.to, fusoHorario: timezone },
      decendio: decendioOf(body.from, timezone),
      totalRegistros: extraction.rows.length,
      colunas: SUMOB_COLUMNS,
      // amostra: o arquivo completo sai na emissão
      amostra: extraction.rows.slice(0, 200),
      intervaloMedioSegundos: averageInterval(extraction.rows),
    };
  });

  /**
   * Emite o arquivo da viagem contestada, já com o nome exigido pela
   * alínea (k), e registra o hash do conteúdo como evidência de que não
   * houve alteração manual (alíneas e, f e g).
   */
  app.post('/arquivo', { preHandler: authenticate }, async (request, reply) => {
    const me = currentUser(request);
    const body = fileSchema.parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, body.operatorId);
    const timezone = await organizationTimezone(me.orgId);
    const fileName = sumobFileName(body.tripExternalId, body.format);

    const extraction = await extractSumobRows({
      operatorId: operator.id,
      assetId: body.assetId,
      from: body.from,
      to: body.to,
      timezone,
      vehicleOrderField: operator.vehicle_order_field,
    });

    if (!extraction.rows.length) {
      throw badRequest(
        'Nenhum registro de localização nesse período para o veículo. ' +
          'Um arquivo vazio não comprova o itinerário — confira o período e se o histórico já foi coletado.',
      );
    }

    const content =
      body.format === 'csv' ? toSumobCsv(extraction) : await toSumobXlsx(extraction);
    const hash = sha256Of(content);
    const decendio = decendioOf(body.from, timezone);

    await query(
      `INSERT INTO sumob_exports
         (organization_id, operator_id, trip_external_id, asset_id, vehicle_order,
          period_from, period_to, decendio, format, file_name, row_count,
          content_sha256, byte_size, timezone, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        me.orgId,
        operator.id,
        body.tripExternalId.trim(),
        body.assetId,
        extraction.vehicleOrder,
        body.from,
        body.to,
        decendio,
        body.format,
        fileName,
        extraction.rows.length,
        hash,
        content.byteLength,
        timezone,
        me.sub,
      ],
    );

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'reports.sumob.export',
      entity: 'sumob_export',
      entityId: body.tripExternalId,
      metadata: { operador: operator.name, registros: extraction.rows.length, hash },
      ip: request.ip,
    });

    reply.header(
      'Content-Type',
      body.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('X-Conteudo-SHA256', hash);
    reply.header('X-Registros', String(extraction.rows.length));
    return reply.send(content);
  });

  /** Trilha dos arquivos emitidos — quem gerou, quando e com que hash. */
  app.get('/exports', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const q = z
      .object({
        operatorId: z.string().uuid().optional(),
        decendio: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(request.query);

    const data = await rows(
      `SELECT e.id, e.trip_external_id, e.asset_id, e.vehicle_order, e.period_from, e.period_to,
              e.decendio, e.format, e.file_name, e.row_count, e.content_sha256, e.byte_size,
              e.created_at, u.name AS created_by_name, op.name AS operator_name
         FROM sumob_exports e
         LEFT JOIN users u ON u.id = e.created_by
         JOIN operators op ON op.id = e.operator_id
        WHERE e.organization_id = $1
          AND ($2::uuid IS NULL OR e.operator_id = $2::uuid)
          AND ($3::text IS NULL OR e.decendio = $3::text)
        ORDER BY e.created_at DESC
        LIMIT $4`,
      [me.orgId, q.operatorId ?? null, q.decendio ?? null, q.limit],
    );
    return { exports: data };
  });

  /** Viagens sincronizadas do veículo — para escolher o período sem digitar. */
  app.get('/viagens', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const q = z
      .object({
        operatorId: z.string().uuid().optional(),
        assetId: zBigId(z),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(request.query);

    const operator = await resolveOperator(me.orgId, q.operatorId);
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 7 * 86400_000);

    const data = await rows(
      `SELECT trip_id, trip_start, trip_end, distance_km, duration_seconds, start_address, end_address
         FROM trips
        WHERE operator_id = $1 AND asset_id = $2 AND trip_start BETWEEN $3 AND $4
        ORDER BY trip_start DESC
        LIMIT 200`,
      [operator.id, q.assetId, from, to],
    );
    if (!data.length) return { viagens: [] };
    return { viagens: data };
  });

  /** Confere se um arquivo entregue continua idêntico ao que foi emitido. */
  app.post('/verificar', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { tripExternalId, sha256 } = z
      .object({ tripExternalId: z.string().min(1), sha256: z.string().length(64) })
      .parse(request.body ?? {});

    // A mesma viagem pode ter sido emitida em CSV e em XLSX, e reemitida
    // depois: confere contra todas as emissões, não só a última.
    const emissoes = await rows<{ content_sha256: string; created_at: Date; file_name: string }>(
      `SELECT content_sha256, created_at, file_name
         FROM sumob_exports
        WHERE organization_id = $1 AND trip_external_id = $2
        ORDER BY created_at DESC`,
      [me.orgId, tripExternalId],
    );
    if (!emissoes.length) throw notFound('Nenhum arquivo emitido para esse ID de viagem.');

    const alvo = sha256.toLowerCase();
    const encontrada = emissoes.find((e) => e.content_sha256 === alvo);

    return {
      confere: Boolean(encontrada),
      arquivo: encontrada?.file_name ?? null,
      emitidoEm: encontrada?.created_at ?? null,
      emissoes: emissoes.map((e) => ({
        arquivo: e.file_name,
        emitidoEm: e.created_at,
        hash: e.content_sha256,
      })),
    };
  });
}

/** Intervalo médio entre pings — indica se a densidade sustenta os 90%. */
function averageInterval(items: Array<{ data: string; hora: string }>): number | null {
  if (items.length < 2) return null;
  const toSeconds = (item: { data: string; hora: string }) => {
    const [d, m, y] = item.data.split('/').map(Number);
    const [hh, mm, ss] = item.hora.split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
  };
  const first = toSeconds(items[0]);
  const last = toSeconds(items[items.length - 1]);
  return Math.round((last - first) / (items.length - 1));
}
