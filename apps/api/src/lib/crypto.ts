import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env.js';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Chave AES-256 derivada de APP_ENCRYPTION_KEY (aceita base64 ou texto puro). */
function masterKey(): Buffer {
  const raw = env.APP_ENCRYPTION_KEY;
  const fromB64 = Buffer.from(raw, 'base64');
  if (fromB64.length === 32) return fromB64;
  return createHash('sha256').update(raw).digest();
}

/** Cifra um segredo com AES-256-GCM. Formato: v1.<iv>.<tag>.<payload> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Hash de senha com scrypt (sem dependências nativas). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, 64);
  return `scrypt$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, , saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Mostra apenas os últimos caracteres de um segredo, para exibição na UI. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}
