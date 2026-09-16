import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { one } from '../../db/pool.js';
import { authenticate, currentUser, type JwtUser } from '../../lib/auth-guard.js';
import { recordAudit } from '../../lib/audit.js';
import {
  authenticateUser,
  changePassword,
  consumeRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  type UserRow,
} from './auth-service.js';

const loginSchema = z.object({
  email: z.string().email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha precisa ter ao menos 8 caracteres'),
});

function toJwtUser(user: UserRow): JwtUser {
  return {
    sub: user.id,
    orgId: user.organization_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
}

async function sessionPayload(app: FastifyInstance, user: UserRow, meta: { ip?: string; userAgent?: string }) {
  const accessToken = app.jwt.sign(toJwtUser(user), { expiresIn: env.ACCESS_TOKEN_TTL });
  const refreshToken = await issueRefreshToken(user.id, meta);
  const organization = await one(
    `SELECT id, name, slug, timezone, settings FROM organizations WHERE id = $1`,
    [user.organization_id],
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.must_change_password,
    },
    organization,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const { email, password } = loginSchema.parse(request.body);
    const user = await authenticateUser(email, password);
    await recordAudit({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'auth.login',
      ip: request.ip,
    });
    return sessionPayload(app, user, { ip: request.ip, userAgent: request.headers['user-agent'] });
  });

  app.post('/refresh', async (request) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const user = await consumeRefreshToken(refreshToken);
    return sessionPayload(app, user, { ip: request.ip, userAgent: request.headers['user-agent'] });
  });

  app.post('/logout', async (request) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
    return { ok: true };
  });

  app.get('/me', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const user = await one(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.phone, u.job_title,
              u.must_change_password, u.last_login_at, u.created_at,
              o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
              o.timezone, o.settings
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE u.id = $1`,
      [me.sub],
    );
    return { user };
  });

  app.post('/change-password', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const body = changePasswordSchema.parse(request.body);
    await changePassword(me.sub, body.currentPassword, body.newPassword);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'auth.change_password',
      ip: request.ip,
    });
    return { ok: true };
  });
}
