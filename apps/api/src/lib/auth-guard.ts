import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from './errors.js';

export type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export interface JwtUser {
  sub: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

/** Exige um token válido. */
export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized('Sessão expirada ou inválida. Faça login novamente.');
  }
}

/** Exige um dos papéis informados (sempre após `authenticate`). */
export function requireRole(...roles: Role[]) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    await authenticate(request);
    if (!roles.includes(request.user.role)) {
      throw forbidden('Seu perfil não tem permissão para esta ação.');
    }
  };
}

export function currentUser(request: FastifyRequest): JwtUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
