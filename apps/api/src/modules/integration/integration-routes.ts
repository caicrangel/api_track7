import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser, requireRole } from '../../lib/auth-guard.js';
import { recordAudit } from '../../lib/audit.js';
import {
  buildClient,
  buildEphemeralClient,
  credentialsInputSchema,
  getCredentialRow,
  saveCredentials,
  toPublicView,
} from './credentials.js';
import { listSyncRuns, runSync } from './sync-service.js';
import { TRACK7_REGIONS } from './track7-client.js';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  /** Configuração atual (sem segredos) + presets de região. */
  app.get('/track7', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const row = await getCredentialRow(me.orgId);
    return {
      integration: toPublicView(row),
      regions: Object.entries(TRACK7_REGIONS).map(([key, value]) => ({ key, ...value })),
    };
  });

  /** Salva credenciais (campos de segredo vazios preservam o valor atual). */
  app.put('/track7', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const input = credentialsInputSchema.parse(request.body);
    const saved = await saveCredentials(me.orgId, input);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.save',
      entity: 'integration',
      metadata: { region: saved.region, apiUrl: saved.api_url },
      ip: request.ip,
    });
    return { integration: toPublicView(saved) };
  });

  /** Testa a conexão com a API da Track7 (autentica e lista organizações). */
  app.post('/track7/test', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const input = credentialsInputSchema.partial().parse(request.body ?? {});
    const startedAt = Date.now();
    const client = await buildEphemeralClient(me.orgId, { region: 'us', ...input });
    try {
      const result = await client.testConnection();
      await recordAudit({
        organizationId: me.orgId,
        userId: me.sub,
        action: 'integration.track7.test',
        metadata: { ok: true },
        ip: request.ip,
      });
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        organisations: result.organisations,
        message: `Conexão estabelecida. ${result.organisations.length} organização(ões) disponível(is).`,
      };
    } catch (err) {
      await recordAudit({
        organizationId: me.orgId,
        userId: me.sub,
        action: 'integration.track7.test',
        metadata: { ok: false, error: (err as Error).message },
        ip: request.ip,
      });
      throw err;
    }
  });

  /** Grupos/sites disponíveis — da base local ou direto da Track7 (?live=true). */
  app.get('/track7/groups', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { live } = z.object({ live: z.coerce.boolean().default(false) }).parse(request.query);

    if (live) {
      const { client, row } = await buildClient(me.orgId);
      const orgs = await client.getOrganisationGroups();
      const rootId = row.organisation_id ?? Number(orgs[0]?.GroupId);
      const tree = rootId ? await client.getSubGroups(rootId) : null;
      return { organisations: orgs, tree };
    }

    const data = await rows(
      `SELECT group_id, parent_group_id, name, group_type, group_type_name, time_zone, level, is_organisation
         FROM t7_groups WHERE organization_id = $1 ORDER BY level, name`,
      [me.orgId],
    );
    return { groups: data };
  });

  /** Dispara uma sincronização. Por padrão roda em segundo plano. */
  app.post('/track7/sync', { preHandler: requireRole('ADMIN', 'MANAGER', 'OPERATOR') }, async (request, reply) => {
    const me = currentUser(request);
    const body = z
      .object({
        kind: z.enum(['catalog', 'incremental', 'history']).default('incremental'),
        wait: z.boolean().default(false),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(request.body ?? {});

    const options = {
      organizationId: me.orgId,
      kind: body.kind,
      triggerSource: 'manual' as const,
      userId: me.sub,
      from: body.from,
      to: body.to,
    };

    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.sync',
      metadata: { kind: body.kind },
      ip: request.ip,
    });

    if (body.wait) return runSync(options);

    void runSync(options).catch((err) => {
      request.log.error({ err }, 'falha na sincronização em segundo plano');
    });
    reply.code(202);
    return { accepted: true, message: 'Sincronização iniciada. Acompanhe pelo histórico.' };
  });

  /** Histórico de sincronizações. */
  app.get('/track7/sync-runs', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    return { runs: await listSyncRuns(me.orgId, limit) };
  });

  /** Diagnóstico ponta a ponta da integração. */
  app.get('/track7/diagnostics', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const row = await getCredentialRow(me.orgId);
    const checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; detail: string }> = [];

    const view = toPublicView(row);
    checks.push({
      name: 'Credenciais cadastradas',
      status: view.configured ? 'ok' : 'error',
      detail: view.configured
        ? 'Client ID, Client Secret, usuário e senha presentes (cifrados).'
        : 'Faltam credenciais. Preencha em Configurações › Integrações.',
    });

    let tokenOk = false;
    if (view.configured) {
      const t0 = Date.now();
      try {
        const { client } = await buildClient(me.orgId);
        await client.getAccessToken(true);
        tokenOk = true;
        checks.push({
          name: 'Autenticação (OAuth2)',
          status: 'ok',
          detail: `Token obtido em ${Date.now() - t0} ms.`,
        });
      } catch (err) {
        checks.push({ name: 'Autenticação (OAuth2)', status: 'error', detail: (err as Error).message });
      }
    }

    if (tokenOk) {
      try {
        const { client } = await buildClient(me.orgId);
        const orgs = await client.getOrganisationGroups();
        checks.push({
          name: 'Organizações visíveis',
          status: orgs.length ? 'ok' : 'warn',
          detail: orgs.length
            ? orgs.map((o) => `${o.Name} (#${o.GroupId})`).join(', ')
            : 'Nenhuma organização retornada para estas credenciais.',
        });
      } catch (err) {
        checks.push({ name: 'Organizações visíveis', status: 'error', detail: (err as Error).message });
      }
    }

    const counts = await one<{ vehicles: number; drivers: number; groups: number; positions: number }>(
      `SELECT
         (SELECT count(*)::int FROM vehicles WHERE organization_id = $1) AS vehicles,
         (SELECT count(*)::int FROM drivers WHERE organization_id = $1) AS drivers,
         (SELECT count(*)::int FROM t7_groups WHERE organization_id = $1) AS groups,
         (SELECT count(*)::int FROM vehicle_last_position WHERE organization_id = $1) AS positions`,
      [me.orgId],
    );
    checks.push({
      name: 'Dados sincronizados',
      status: (counts?.vehicles ?? 0) > 0 ? 'ok' : 'warn',
      detail: `${counts?.vehicles ?? 0} veículos · ${counts?.drivers ?? 0} motoristas · ${counts?.groups ?? 0} grupos · ${counts?.positions ?? 0} posições atuais.`,
    });

    return { checks, integration: view, counts };
  });
}
