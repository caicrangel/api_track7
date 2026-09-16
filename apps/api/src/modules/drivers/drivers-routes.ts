import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';

const listSchema = z.object({
  operatorId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  includeSystem: z.coerce.boolean().default(false),
});

export async function driversRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const q = listSchema.parse(request.query);

    const params: unknown[] = [me.orgId, q.operatorId ?? null];
    const where = ['d.organization_id = $1', '($2::uuid IS NULL OR d.operator_id = $2::uuid)'];
    if (!q.includeSystem) where.push('d.is_system_driver = false');
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(d.name ILIKE $${params.length} OR d.employee_number ILIKE $${params.length})`);
    }

    const total = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM drivers d WHERE ${where.join(' AND ')}`,
      params,
    );
    params.push(q.pageSize, (q.page - 1) * q.pageSize);

    const data = await rows(
      `SELECT d.driver_id, d.name, d.employee_number, d.mobile_number, d.email,
              d.extended_driver_id, d.site_id, g.name AS site_name, d.synced_at,
              d.operator_id, op.name AS operator_name
         FROM drivers d
         JOIN operators op ON op.id = d.operator_id
         LEFT JOIN t7_groups g ON g.operator_id = d.operator_id AND g.group_id = d.site_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.name NULLS LAST
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data, page: q.page, pageSize: q.pageSize, total: total?.count ?? 0 };
  });
}
