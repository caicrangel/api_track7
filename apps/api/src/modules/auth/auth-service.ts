import { one, query } from '../../db/pool.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import type { Role } from '../../lib/auth-guard.js';
import { env } from '../../env.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface UserRow {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
  must_change_password: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return one<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
}

export async function authenticateUser(email: string, password: string): Promise<UserRow> {
  const user = await findUserByEmail(email);
  if (!user) throw unauthorized('E-mail ou senha inválidos.');

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized('Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.');
  }
  if (user.status !== 'ACTIVE') throw unauthorized('Usuário inativo. Procure o administrador.');

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS ? `now() + interval '${LOCK_MINUTES} minutes'` : 'NULL';
    await query(
      `UPDATE users SET failed_attempts = $2, locked_until = ${lock}, updated_at = now() WHERE id = $1`,
      [user.id, attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts],
    );
    throw unauthorized('E-mail ou senha inválidos.');
  }

  await query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1`,
    [user.id],
  );
  return user;
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const token = randomToken(48);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
    [userId, sha256(token), String(env.REFRESH_TOKEN_TTL_DAYS), meta.userAgent ?? null, meta.ip ?? null],
  );
  return token;
}

export async function consumeRefreshToken(token: string): Promise<UserRow> {
  const record = await one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  if (!record) throw unauthorized('Sessão expirada. Faça login novamente.');

  // rotação: o token usado é invalidado
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [record.id]);

  const user = await one<UserRow>(`SELECT * FROM users WHERE id = $1 AND status = 'ACTIVE'`, [record.user_id]);
  if (!user) throw unauthorized('Usuário indisponível.');
  return user;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
    sha256(token),
  ]);
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw badRequest('A senha atual está incorreta.');
  }
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`,
    [userId, await hashPassword(newPassword)],
  );
  await revokeAllUserTokens(userId);
}
