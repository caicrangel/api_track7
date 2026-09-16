import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toCsv } from '../../lib/csv.js';
import { findReport, REPORTS } from './report-catalog.js';

const runSchema = z.object({
  /** Vazio = consolidado de todas as operadoras da conta. */
  operatorId: z.string().uuid().optional(),
  params: z.record(z.unknown()).default({}),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(50000).default(5000),
});

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  /** Catálogo disponível (o front monta formulário e tabela a partir daqui). */
  app.get('/', { preHandler: authenticate }, async () => ({
    reports: REPORTS.map(({ code, name, description, category, params, columns }) => ({
      code,
      name,
      description,
      category,
      params,
      columns,
    })),
  }));

  /** Execução de um relatório. */
  app.post('/:code/run', { preHandler: authenticate }, async (request, reply) => {
    const me = currentUser(request);
    const { code } = z.object({ code: z.string() }).parse(request.params);
    const body = runSchema.parse(request.body ?? {});

    const report = findReport(code);
    if (!report) throw notFound(`Relatório "${code}" não encontrado.`);

    for (const param of report.params) {
      if (param.required && (body.params[param.name] === undefined || body.params[param.name] === '')) {
        throw badRequest(`Parâmetro obrigatório ausente: ${param.label}.`);
      }
    }

    const startedAt = Date.now();
    const { sql, values } = report.build(
      { organizationId: me.orgId, operatorId: body.operatorId ?? null },
      body.params,
    );

    let data: Array<Record<string, unknown>>;
    try {
      data = await rows(`${sql}`, values);
    } catch (err) {
      await query(
        `INSERT INTO report_executions
           (organization_id, operator_id, report_code, params, status, format, error, created_by)
         VALUES ($1,$2,$3,$4::jsonb,'ERROR',$5,$6,$7)`,
        [
          me.orgId,
          body.operatorId ?? null,
          code,
          JSON.stringify(body.params),
          body.format,
          (err as Error).message,
          me.sub,
        ],
      );
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    await query(
      `INSERT INTO report_executions
         (organization_id, operator_id, report_code, params, status, row_count, duration_ms, format, created_by)
       VALUES ($1,$2,$3,$4::jsonb,'SUCCESS',$5,$6,$7,$8)`,
      [
        me.orgId,
        body.operatorId ?? null,
        code,
        JSON.stringify(body.params),
        data.length,
        durationMs,
        body.format,
        me.sub,
      ],
    );

    if (body.format === 'csv') {
      const csv = toCsv(data, report.columns.map((c) => ({ key: c.key, label: c.label })));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${code}-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return csv;
    }

    return {
      report: { code: report.code, name: report.name, columns: report.columns },
      data: data.slice(0, body.limit),
      rowCount: data.length,
      durationMs,
      generatedAt: new Date().toISOString(),
    };
  });

  /** Histórico de execuções. */
  app.get('/executions', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const executions = await rows(
      `SELECT e.id, e.report_code, e.params, e.status, e.row_count, e.duration_ms, e.format,
              e.error, e.created_at, u.name AS created_by_name, op.name AS operator_name
         FROM report_executions e
         LEFT JOIN users u ON u.id = e.created_by
         LEFT JOIN operators op ON op.id = e.operator_id
        WHERE e.organization_id = $1
        ORDER BY e.created_at DESC
        LIMIT $2`,
      [me.orgId, limit],
    );
    return { executions };
  });
}
