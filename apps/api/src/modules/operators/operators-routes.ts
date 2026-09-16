import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, rows } from '../../db/pool.js';
import { authenticate, currentUser, requireRole } from '../../lib/auth-guard.js';
import { recordAudit } from '../../lib/audit.js';
import { conflict } from '../../lib/errors.js';
import { getOperator, listOperators } from './operators-service.js';

const createSchema = z.object({
  name: z.string().min(2, 'Informe o nome da empresa operadora'),
  shortName: z.string().optional(),
  code: z.string().optional(),
  document: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  /** Campo da Track7 que representa o número de ordem do veículo. */
  vehicleOrderField: z.enum(['fleet_number', 'description', 'registration_number']).optional(),
});

export async function operatorsRoutes(app: FastifyInstance): Promise<void> {
  /** Lista as operadoras — alimenta o seletor do topo e os filtros. */
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { includeInactive } = z
      .object({ includeInactive: z.coerce.boolean().default(false) })
      .parse(request.query);

    const operators = await listOperators(me.orgId, { includeInactive });

    // resumo por operadora: frota, credenciais e situação do coletor
    const summary = await rows<{
      operator_id: string;
      veiculos: number;
      credenciais: boolean;
      ultima_posicao: Date | null;
      ultima_sync: Date | null;
    }>(
      `SELECT op.id AS operator_id,
              (SELECT count(*)::int FROM vehicles v WHERE v.operator_id = op.id AND v.status = 'ACTIVE') AS veiculos,
              EXISTS (SELECT 1 FROM integration_credentials c
                       WHERE c.operator_id = op.id AND c.client_id_enc IS NOT NULL) AS credenciais,
              (SELECT max(p.recorded_at) FROM vehicle_last_position p WHERE p.operator_id = op.id) AS ultima_posicao,
              (SELECT c.last_sync_at FROM integration_credentials c WHERE c.operator_id = op.id LIMIT 1) AS ultima_sync
         FROM operators op
        WHERE op.organization_id = $1`,
      [me.orgId],
    );

    const byId = new Map(summary.map((s) => [s.operator_id, s]));
    return {
      operators: operators.map((op) => ({
        id: op.id,
        name: op.name,
        shortName: op.short_name,
        code: op.code,
        document: op.document,
        provider: op.provider,
        status: op.status,
        notes: op.notes,
        createdAt: op.created_at,
        source: op.source,
        apiVisible: op.api_visible,
        vehicleOrderField: op.vehicle_order_field,
        track7OrganisationId: op.track7_organisation_id,
        stats: byId.get(op.id) ?? null,
      })),
    };
  });

  app.get('/:id', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { operator: await getOperator(me.orgId, id) };
  });

  app.post('/', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request, reply) => {
    const me = currentUser(request);
    const body = createSchema.parse(request.body);

    if (body.code) {
      const dup = await one(
        `SELECT id FROM operators WHERE organization_id = $1 AND lower(code) = lower($2)`,
        [me.orgId, body.code],
      );
      if (dup) throw conflict('Já existe uma operadora com este código.');
    }

    const operator = await one(
      `INSERT INTO operators (organization_id, name, short_name, code, document, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, short_name, code, document, provider, status, notes, created_at`,
      [me.orgId, body.name, body.shortName ?? null, body.code ?? null, body.document ?? null, body.notes ?? null],
    );

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'operators.create',
      entity: 'operator',
      entityId: (operator as { id: string }).id,
      metadata: { name: body.name },
      ip: request.ip,
    });

    reply.code(201);
    return { operator };
  });

  app.patch('/:id', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    await getOperator(me.orgId, id);

    const operator = await one(
      `UPDATE operators SET
         name = coalesce($3, name),
         short_name = coalesce($4, short_name),
         code = coalesce($5, code),
         document = coalesce($6, document),
         notes = coalesce($7, notes),
         status = coalesce($8, status),
         vehicle_order_field = coalesce($9, vehicle_order_field),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, name, short_name, code, document, provider, status, notes,
                 vehicle_order_field, created_at`,
      [
        id,
        me.orgId,
        body.name ?? null,
        body.shortName ?? null,
        body.code ?? null,
        body.document ?? null,
        body.notes ?? null,
        body.status ?? null,
        body.vehicleOrderField ?? null,
      ],
    );

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'operators.update',
      entity: 'operator',
      entityId: id,
      metadata: body,
      ip: request.ip,
    });
    return { operator };
  });

  /**
   * Exclui a operadora e, em cascata, tudo que veio da Track7 para ela.
   * Exige confirmar o nome — é uma ação destrutiva e irreversível.
   */
  app.delete('/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { confirmName } = z.object({ confirmName: z.string() }).parse(request.body ?? {});

    const operator = await getOperator(me.orgId, id);
    if (confirmName.trim() !== operator.name) {
      throw conflict('Confirme o nome exato da operadora para excluí-la.');
    }

    await query(`DELETE FROM positions WHERE operator_id = $1`, [id]);
    await query(`DELETE FROM operators WHERE id = $1`, [id]);

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'operators.delete',
      entity: 'operator',
      entityId: id,
      metadata: { name: operator.name },
      ip: request.ip,
    });
    return { ok: true };
  });
}
