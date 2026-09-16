import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, rows } from '../../db/pool.js';
import { authenticate, currentUser, requireRole } from '../../lib/auth-guard.js';
import { hashPassword, randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { revokeAllUserTokens } from '../auth/auth-service.js';

const roleEnum = z.enum(['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']);

const createSchema = z.object({
  name: z.string().min(3, 'Informe o nome completo'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres').optional(),
  role: roleEnum.default('VIEWER'),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(3).optional(),
  email: z.string().email().optional(),
  role: roleEnum.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
});

const listSchema = z.object({
  search: z.string().optional(),
  role: roleEnum.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const q = listSchema.parse(request.query);
    const params: unknown[] = [me.orgId];
    const where = ['organization_id = $1'];

    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`role = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }

    const total = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE ${where.join(' AND ')}`,
      params,
    );
    params.push(q.pageSize, (q.page - 1) * q.pageSize);

    const data = await rows(
      `SELECT id, name, email, role, status, phone, job_title, last_login_at, created_at
         FROM users WHERE ${where.join(' AND ')}
        ORDER BY name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data, page: q.page, pageSize: q.pageSize, total: total?.count ?? 0 };
  });

  app.post('/', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const me = currentUser(request);
    const body = createSchema.parse(request.body);

    const exists = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [body.email]);
    if (exists) throw conflict('Já existe um usuário com este e-mail.');

    const generated = body.password ?? `${randomToken(6)}Aa1!`;
    const user = await one(
      `INSERT INTO users (organization_id, name, email, password_hash, role, phone, job_title, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, email, role, status, phone, job_title, created_at`,
      [
        me.orgId,
        body.name,
        body.email.toLowerCase(),
        await hashPassword(generated),
        body.role,
        body.phone ?? null,
        body.jobTitle ?? null,
        !body.password,
      ],
    );

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'users.create',
      entity: 'user',
      entityId: (user as { id: string }).id,
      metadata: { role: body.role },
      ip: request.ip,
    });

    reply.code(201);
    return { user, temporaryPassword: body.password ? undefined : generated };
  });

  app.patch('/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);

    const target = await one<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE id = $1 AND organization_id = $2`,
      [id, me.orgId],
    );
    if (!target) throw notFound('Usuário não encontrado.');

    if (body.email) {
      const dup = await one(`SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`, [body.email, id]);
      if (dup) throw conflict('Já existe um usuário com este e-mail.');
    }
    if ((body.role && body.role !== 'ADMIN') || body.status === 'INACTIVE') {
      await assertNotLastAdmin(me.orgId, id, target.role);
    }

    const updates: string[] = [];
    const params: unknown[] = [id, me.orgId];
    const push = (column: string, value: unknown) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };

    if (body.name !== undefined) push('name', body.name);
    if (body.email !== undefined) push('email', body.email.toLowerCase());
    if (body.role !== undefined) push('role', body.role);
    if (body.status !== undefined) push('status', body.status);
    if (body.phone !== undefined) push('phone', body.phone);
    if (body.jobTitle !== undefined) push('job_title', body.jobTitle);
    if (!updates.length) throw badRequest('Nada para atualizar.');

    const user = await one(
      `UPDATE users SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING id, name, email, role, status, phone, job_title, last_login_at, created_at`,
      params,
    );
    if (body.status === 'INACTIVE') await revokeAllUserTokens(id);

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'users.update',
      entity: 'user',
      entityId: id,
      metadata: body,
      ip: request.ip,
    });
    return { user };
  });

  app.post('/:id/reset-password', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ password: z.string().min(8).optional() }).parse(request.body ?? {});

    const target = await one(`SELECT id FROM users WHERE id = $1 AND organization_id = $2`, [id, me.orgId]);
    if (!target) throw notFound('Usuário não encontrado.');

    const password = body.password ?? `${randomToken(6)}Aa1!`;
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = $3, failed_attempts = 0,
              locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [id, await hashPassword(password), !body.password],
    );
    await revokeAllUserTokens(id);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'users.reset_password',
      entity: 'user',
      entityId: id,
      ip: request.ip,
    });
    return { ok: true, temporaryPassword: body.password ? undefined : password };
  });

  app.delete('/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (id === me.sub) throw forbidden('Você não pode excluir o próprio usuário.');

    const target = await one<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE id = $1 AND organization_id = $2`,
      [id, me.orgId],
    );
    if (!target) throw notFound('Usuário não encontrado.');
    await assertNotLastAdmin(me.orgId, id, target.role);

    await query(`DELETE FROM users WHERE id = $1`, [id]);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'users.delete',
      entity: 'user',
      entityId: id,
      ip: request.ip,
    });
    return { ok: true };
  });
}

async function assertNotLastAdmin(orgId: string, userId: string, role: string): Promise<void> {
  if (role !== 'ADMIN') return;
  const remaining = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM users
      WHERE organization_id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' AND id <> $2`,
    [orgId, userId],
  );
  if ((remaining?.count ?? 0) === 0) {
    throw forbidden('É necessário manter ao menos um administrador ativo.');
  }
}
