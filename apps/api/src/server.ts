import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './env.js';
import { bootstrap } from './bootstrap.js';
import { pool } from './db/pool.js';
import { closeRedis } from './lib/cache.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { usersRoutes } from './modules/users/users-routes.js';
import { operatorsRoutes } from './modules/operators/operators-routes.js';
import { settingsRoutes } from './modules/settings/settings-routes.js';
import { integrationRoutes } from './modules/integration/integration-routes.js';
import { vehiclesRoutes } from './modules/vehicles/vehicles-routes.js';
import { driversRoutes } from './modules/drivers/drivers-routes.js';
import { reportsRoutes } from './modules/reports/reports-routes.js';
import { sumobRoutes } from './modules/reports/sumob-routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        issues: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.status(error.statusCode).send({
        error: error.code,
        message: (error as Error).message,
        details: error.details,
      });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde um instante.' });
    }
    request.log.error({ err: error }, 'erro não tratado');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Erro interno no servidor.' : (error as Error).message,
    });
  });

  app.get('/api/health', async () => {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    return {
      status: 'ok',
      service: 'fleetgov-api',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      database: { status: 'ok', latencyMs: Date.now() - dbStart },
      timestamp: new Date().toISOString(),
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(operatorsRoutes, { prefix: '/api/operators' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(integrationRoutes, { prefix: '/api/integrations' });
  await app.register(vehiclesRoutes, { prefix: '/api/vehicles' });
  await app.register(driversRoutes, { prefix: '/api/drivers' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(sumobRoutes, { prefix: '/api/reports/sumob' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    const result = await bootstrap((msg) => app.log.info(msg));
    if (result.createdAdmin) {
      app.log.info(
        `[bootstrap] acesse com ${env.BOOTSTRAP_ADMIN_EMAIL} — troque a senha no primeiro acesso.`,
      );
    }
  } catch (err) {
    app.log.error({ err }, 'falha ao preparar o banco de dados');
    process.exit(1);
  }

  await app.listen({ port: env.PORT, host: env.HOST });

  const shutdown = async (signal: string) => {
    app.log.info(`recebido ${signal}, encerrando...`);
    await app.close();
    await pool.end().catch(() => {});
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isDirectRun = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
