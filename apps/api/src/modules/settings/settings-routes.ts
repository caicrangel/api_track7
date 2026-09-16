import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser, requireRole } from '../../lib/auth-guard.js';
import { recordAudit } from '../../lib/audit.js';

const settingsSchema = z.object({
  name: z.string().min(2).optional(),
  document: z.string().optional(),
  timezone: z.string().optional(),
  settings: z
    .object({
      brandName: z.string().optional(),
      primaryColor: z.string().optional(),
      logoUrl: z.string().optional(),
      supportEmail: z.string().email().optional().or(z.literal('')),
      speedLimitDefault: z.number().int().min(10).max(200).optional(),
      idleThresholdMinutes: z.number().int().min(1).max(600).optional(),
      offlineThresholdHours: z.number().int().min(1).max(720).optional(),
    })
    .partial()
    .optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const organization = await one(
      `SELECT id, name, slug, document, timezone, settings, created_at FROM organizations WHERE id = $1`,
      [me.orgId],
    );
    return { organization };
  });

  app.put('/', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const body = settingsSchema.parse(request.body);

    const organization = await one(
      `UPDATE organizations
          SET name = coalesce($2, name),
              document = coalesce($3, document),
              timezone = coalesce($4, timezone),
              settings = settings || coalesce($5::jsonb, '{}'::jsonb),
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, slug, document, timezone, settings`,
      [me.orgId, body.name ?? null, body.document ?? null, body.timezone ?? null,
       body.settings ? JSON.stringify(body.settings) : null],
    );

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'settings.update',
      entity: 'organization',
      entityId: me.orgId,
      metadata: body,
      ip: request.ip,
    });
    return { organization };
  });

  /** Trilha de auditoria da organização. */
  app.get('/audit', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().optional(),
      })
      .parse(request.query);

    const params: unknown[] = [me.orgId];
    let filter = '';
    if (q.action) {
      params.push(`${q.action}%`);
      filter = `AND a.action LIKE $${params.length}`;
    }
    params.push(q.limit);

    const logs = await rows(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.ip, a.created_at,
              u.name AS user_name, u.email AS user_email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.organization_id = $1 ${filter}
        ORDER BY a.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return { logs };
  });
}
