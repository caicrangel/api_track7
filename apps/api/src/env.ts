import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default('0.0.0.0'),
  ROLE: z.enum(['api', 'worker']).default('api'),
  TZ: z.string().default('America/Sao_Paulo'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter ao menos 32 caracteres'),
  APP_ENCRYPTION_KEY: z.string().min(16, 'APP_ENCRYPTION_KEY é obrigatória (32 bytes em base64)'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),

  BOOTSTRAP_ORG_NAME: z.string().default('Organização'),
  BOOTSTRAP_ADMIN_NAME: z.string().default('Administrador'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@fleetgov.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default('Admin@123456'),

  TRACK7_IDENTITY_URL: z.string().default('https://identity.us.mixtelematics.com/core'),
  TRACK7_API_URL: z.string().default('https://integrate.us.mixtelematics.com'),
  TRACK7_SCOPE: z.string().default('offline_access MiX.Integrate'),
  TRACK7_CLIENT_ID: z.string().optional(),
  TRACK7_CLIENT_SECRET: z.string().optional(),
  TRACK7_USERNAME: z.string().optional(),
  TRACK7_PASSWORD: z.string().optional(),
  TRACK7_ORGANISATION_ID: z.string().optional(),

  SYNC_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  SYNC_CRON: z.string().default('0 */6 * * *'),
  SYNC_HISTORY_DAYS: z.coerce.number().default(7),

  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[FleetGov] Configuração inválida:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
