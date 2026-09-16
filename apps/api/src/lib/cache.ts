import { Redis } from 'ioredis';
import { env } from '../env.js';

let client: Redis | null = null;

export function redis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    client.on('error', () => {
      /* cache é opcional: falhas não derrubam a aplicação */
    });
  }
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = redis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
}

export async function cacheDelPrefix(prefix: string): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    const stream = r.scanStream({ match: `${prefix}*`, count: 200 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await r.del(...keys);
    }
  } catch {
    /* ignore */
  }
}

/** Lock distribuído simples — evita duas sincronizações simultâneas. */
export async function acquireLock(key: string, ttlSeconds = 900): Promise<(() => Promise<void>) | null> {
  const r = redis();
  if (!r) return async () => {};
  try {
    const ok = await r.set(`lock:${key}`, '1', 'EX', ttlSeconds, 'NX');
    if (!ok) return null;
    return async () => {
      try {
        await r.del(`lock:${key}`);
      } catch {
        /* ignore */
      }
    };
  } catch {
    return async () => {};
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
