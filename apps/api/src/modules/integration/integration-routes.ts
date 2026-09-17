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
  getSharedCredentialRow,
  resolveCredential,
  saveCredentials,
  toPublicView,
} from './credentials.js';
import { listSyncRuns, runSync } from './sync-service.js';
import { discoverOperators } from './discovery.js';
import {
  assertPerOperatorCredentialsAllowed,
  getIntegrationModeState,
  setIntegrationMode,
} from './integration-mode.js';
import { backfillPositions, collectPositions, getCursor, seedCursor } from './position-stream.js';
import { TRACK7_REGIONS } from './track7-client.js';
import { resolveOperator } from '../operators/operators-service.js';
import { bigId } from '../../lib/big-id.js';

/** Toda rota de integração age sobre uma empresa operadora específica. */
const operatorQuerySchema = z.object({ operatorId: z.string().uuid().optional() });

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  /** Configuração atual (sem segredos) + presets de região. */
  app.get('/track7', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = operatorQuerySchema.parse(request.query);
    const operator = await resolveOperator(me.orgId, operatorId);
    const effective = await resolveCredential(operator);
    const modeState = await getIntegrationModeState(me.orgId);
    return {
      mode: modeState.mode,
      operator: {
        id: operator.id,
        name: operator.name,
        track7OrganisationId: operator.track7_organisation_id,
      },
      integration: toPublicView(effective?.row ?? null, effective?.shared ?? false),
      regions: Object.entries(TRACK7_REGIONS).map(([key, value]) => ({ key, ...value })),
    };
  });

  /** Salva credenciais (campos de segredo vazios preservam o valor atual). */
  app.put('/track7', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { operatorId, ...body } = z
      .object({ operatorId: z.string().uuid().optional() })
      .passthrough()
      .parse(request.body ?? {});
    await assertPerOperatorCredentialsAllowed(me.orgId);
    const operator = await resolveOperator(me.orgId, operatorId as string | undefined);
    const input = credentialsInputSchema.parse(body);
    const saved = await saveCredentials(me.orgId, operator.id, input);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.save',
      entity: 'integration',
      metadata: { operator: operator.name, region: saved.region, apiUrl: saved.api_url },
      ip: request.ip,
    });
    return { operator: { id: operator.id, name: operator.name }, integration: toPublicView(saved) };
  });

  /** Testa a conexão com a API da Track7 (autentica e lista organizações). */
  app.post('/track7/test', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { operatorId, ...body } = z
      .object({ operatorId: z.string().uuid().optional() })
      .passthrough()
      .parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, operatorId as string | undefined);
    const input = credentialsInputSchema.partial().parse(body);
    const startedAt = Date.now();
    const client = await buildEphemeralClient(me.orgId, operator.id, { region: 'us', ...input });
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

  /** Modo de integração da conta e os pré-requisitos para trocá-lo. */
  app.get('/track7/mode', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    return getIntegrationModeState(me.orgId);
  });

  /**
   * Troca o modo. Ligar o consórcio só passa se o acesso da conta realmente
   * autenticar na Track7 — credencial preenchida não é credencial que funciona.
   */
  app.put('/track7/mode', { preHandler: requireRole('ADMIN') }, async (request) => {
    const me = currentUser(request);
    const { mode } = z
      .object({ mode: z.enum(['POR_OPERADORA', 'CONSORCIO']) })
      .parse(request.body ?? {});

    const result = await setIntegrationMode(me.orgId, mode, me.sub);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.mode',
      entity: 'organization',
      entityId: me.orgId,
      metadata: { mode, organisationsVisible: result.organisationsVisible },
      ip: request.ip,
    });
    return { ...result, state: await getIntegrationModeState(me.orgId) };
  });

  /**
   * Credencial compartilhada da conta — um único acesso que atende todas as
   * operadoras que não tiverem chaves próprias.
   */
  app.get('/track7/shared', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const row = await getSharedCredentialRow(me.orgId);
    return {
      integration: toPublicView(row, true),
      regions: Object.entries(TRACK7_REGIONS).map(([key, value]) => ({ key, ...value })),
    };
  });

  app.put('/track7/shared', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const input = credentialsInputSchema.parse(request.body ?? {});
    const saved = await saveCredentials(me.orgId, null, { ...input, credentialScope: 'ORGANIZATION' });
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.save_shared',
      entity: 'integration',
      metadata: { region: saved.region, apiUrl: saved.api_url },
      ip: request.ip,
    });

    // No modo consórcio a lista de empresas vem da API: já reconcilia.
    const state = await getIntegrationModeState(me.orgId);
    let discovery = null;
    if (state.mode === 'CONSORCIO') {
      discovery = await discoverOperators(me.orgId, { apply: true }).catch(() => null);
    }

    return { integration: toPublicView(saved, true), discovery };
  });

  /**
   * Lista as organizações que a credencial enxerga e as compara com as
   * operadoras cadastradas. Com `apply`, cria e vincula automaticamente.
   */
  app.post('/track7/discover', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { apply, ...input } = z
      .object({ apply: z.boolean().default(false) })
      .passthrough()
      .parse(request.body ?? {});

    const result = await discoverOperators(me.orgId, {
      apply,
      input: credentialsInputSchema.partial().parse(input) as never,
    });

    if (apply) {
      await recordAudit({
        organizationId: me.orgId,
        userId: me.sub,
        action: 'integration.track7.discover',
        metadata: { criadas: result.created, vinculadas: result.linked },
        ip: request.ip,
      });
    }
    return result;
  });

  /** Grupos/sites disponíveis — da base local ou direto da Track7 (?live=true). */
  app.get('/track7/groups', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { live, operatorId } = z
      .object({ live: z.coerce.boolean().default(false), operatorId: z.string().uuid().optional() })
      .parse(request.query);
    const operator = await resolveOperator(me.orgId, operatorId);

    if (live) {
      const { client } = await buildClient(operator.id);
      const orgs = await client.getOrganisationGroups();
      const rootId = operator.track7_organisation_id ?? bigId(orgs[0]?.GroupId);
      const tree = rootId ? await client.getSubGroups(rootId) : null;
      return { organisations: orgs, tree };
    }

    const data = await rows(
      `SELECT group_id, parent_group_id, name, group_type, group_type_name, time_zone, level, is_organisation
         FROM t7_groups WHERE operator_id = $1 ORDER BY level, name`,
      [operator.id],
    );
    return { groups: data };
  });

  /** Dispara uma sincronização. Por padrão roda em segundo plano. */
  app.post('/track7/sync', { preHandler: requireRole('ADMIN', 'MANAGER', 'OPERATOR') }, async (request, reply) => {
    const me = currentUser(request);
    const body = z
      .object({
        operatorId: z.string().uuid().optional(),
        kind: z.enum(['catalog', 'incremental', 'history']).default('incremental'),
        wait: z.boolean().default(false),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, body.operatorId);

    const options = {
      organizationId: me.orgId,
      operatorId: operator.id,
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
      metadata: { kind: body.kind, operator: operator.name },
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
    const { limit, operatorId } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        operatorId: z.string().uuid().optional(),
      })
      .parse(request.query);
    return { runs: await listSyncRuns(me.orgId, limit, operatorId) };
  });

  /** Situação do coletor contínuo de posições. */
  app.get('/track7/stream', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = operatorQuerySchema.parse(request.query);
    const operator = await resolveOperator(me.orgId, operatorId);
    const cursor = await getCursor(operator.id);
    const stats = await one<{ total: number; ultimas_24h: number; ultima: Date | null; veiculos: number }>(
      `SELECT count(*)::bigint AS total,
              count(*) FILTER (WHERE recorded_at >= now() - interval '24 hours')::bigint AS ultimas_24h,
              max(recorded_at) AS ultima,
              count(DISTINCT asset_id)::int AS veiculos
         FROM positions
        WHERE operator_id = $1 AND recorded_at >= now() - interval '7 days'`,
      [operator.id],
    );
    return { operator: { id: operator.id, name: operator.name }, cursor, stats };
  });

  /** Executa um ciclo do coletor sob demanda (útil para testar a conexão). */
  app.post('/track7/stream/collect', { preHandler: requireRole('ADMIN', 'MANAGER', 'OPERATOR') }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = z.object({ operatorId: z.string().uuid().optional() }).parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, operatorId);
    return collectPositions(me.orgId, operator.id);
  });

  /** Reposiciona o ponteiro do fluxo (a partir de uma data ou do presente). */
  app.post('/track7/stream/seed', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { from, operatorId } = z
      .object({ from: z.coerce.date().optional(), operatorId: z.string().uuid().optional() })
      .parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, operatorId);
    const token = await seedCursor(me.orgId, operator.id, from);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.stream_seed',
      metadata: { token },
      ip: request.ip,
    });
    return { sinceToken: token };
  });

  /** Preenche lacunas do histórico por período (consulta from/to). */
  app.post('/track7/stream/backfill', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { from, to, operatorId } = z
      .object({
        from: z.coerce.date(),
        to: z.coerce.date().default(() => new Date()),
        operatorId: z.string().uuid().optional(),
      })
      .parse(request.body ?? {});
    const operator = await resolveOperator(me.orgId, operatorId);
    await recordAudit({
      organizationId: me.orgId,
      userId: me.sub,
      action: 'integration.track7.stream_backfill',
      metadata: { from, to },
      ip: request.ip,
    });
    return backfillPositions(me.orgId, operator.id, from, to);
  });

  /** Diagnóstico ponta a ponta da integração. */
  app.get('/track7/diagnostics', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = operatorQuerySchema.parse(request.query);
    const operator = await resolveOperator(me.orgId, operatorId);
    const row = await getCredentialRow(operator.id);
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
        const { client } = await buildClient(operator.id);
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
        const { client } = await buildClient(operator.id);
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
         (SELECT count(*)::int FROM vehicles WHERE operator_id = $1) AS vehicles,
         (SELECT count(*)::int FROM drivers WHERE operator_id = $1) AS drivers,
         (SELECT count(*)::int FROM t7_groups WHERE operator_id = $1) AS groups,
         (SELECT count(*)::int FROM vehicle_last_position WHERE operator_id = $1) AS positions`,
      [operator.id],
    );
    checks.push({
      name: 'Dados sincronizados',
      status: (counts?.vehicles ?? 0) > 0 ? 'ok' : 'warn',
      detail: `${counts?.vehicles ?? 0} veículos · ${counts?.drivers ?? 0} motoristas · ${counts?.groups ?? 0} grupos · ${counts?.positions ?? 0} posições atuais.`,
    });

    return { operator: { id: operator.id, name: operator.name }, checks, integration: view, counts };
  });
}
