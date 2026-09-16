import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { Track7Client, TRACK7_REGIONS } from './track7-client.js';
import { getOperatorById, type OperatorRow } from '../operators/operators-service.js';

export interface IntegrationCredentialRow {
  id: string;
  organization_id: string;
  /** Nulo quando a credencial é compartilhada pela conta. */
  operator_id: string | null;
  credential_scope: 'OPERATOR' | 'ORGANIZATION';
  provider: string;
  label: string;
  region: string;
  identity_url: string;
  api_url: string;
  scope: string;
  client_id_enc: string | null;
  client_secret_enc: string | null;
  username_enc: string | null;
  password_enc: string | null;
  organisation_id: number | null;
  group_ids: number[];
  sync_enabled: boolean;
  sync_cron: string;
  history_days: number;
  stream_enabled: boolean;
  stream_interval_seconds: number;
  stream_quantity: number;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  updated_at: Date;
}

export const credentialsInputSchema = z.object({
  region: z.string().default('us'),
  identityUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
  scope: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  organisationId: z.union([z.number(), z.string(), z.null()]).optional(),
  groupIds: z.array(z.union([z.number(), z.string()])).optional(),
  /** OPERATOR = chaves próprias da empresa · ORGANIZATION = acesso único do consórcio. */
  credentialScope: z.enum(['OPERATOR', 'ORGANIZATION']).optional(),
  syncEnabled: z.boolean().optional(),
  syncCron: z.string().optional(),
  historyDays: z.number().int().min(1).max(90).optional(),
  streamEnabled: z.boolean().optional(),
  streamIntervalSeconds: z.number().int().min(10).max(3600).optional(),
  streamQuantity: z.number().int().min(1).max(1000).optional(),
});

export type CredentialsInput = z.infer<typeof credentialsInputSchema>;

/** Credencial própria da operadora, se houver. */
export async function getCredentialRow(operatorId: string): Promise<IntegrationCredentialRow | null> {
  return one<IntegrationCredentialRow>(
    `SELECT * FROM integration_credentials WHERE operator_id = $1 AND provider = 'track7'`,
    [operatorId],
  );
}

/** Credencial compartilhada da conta — atende todas as operadoras sem chaves próprias. */
export async function getSharedCredentialRow(
  organizationId: string,
): Promise<IntegrationCredentialRow | null> {
  return one<IntegrationCredentialRow>(
    `SELECT * FROM integration_credentials
      WHERE organization_id = $1 AND operator_id IS NULL AND provider = 'track7'`,
    [organizationId],
  );
}

/**
 * Credencial efetiva de uma operadora: a própria tem precedência; na falta
 * dela, vale a credencial compartilhada da conta.
 */
export async function resolveCredential(
  operator: OperatorRow,
): Promise<{ row: IntegrationCredentialRow; shared: boolean } | null> {
  const own = await getCredentialRow(operator.id);
  if (own?.client_id_enc) return { row: own, shared: false };

  const shared = await getSharedCredentialRow(operator.organization_id);
  if (shared?.client_id_enc) return { row: shared, shared: true };

  return own ? { row: own, shared: false } : null;
}

/** Versão segura para a UI — nunca devolve segredos, apenas se estão preenchidos. */
export function toPublicView(row: IntegrationCredentialRow | null, shared = false) {
  if (!row) {
    const preset = TRACK7_REGIONS.us;
    return {
      configured: false,
      region: 'us',
      identityUrl: preset.identityUrl,
      apiUrl: preset.apiUrl,
      scope: 'offline_access MiX.Integrate',
      hasClientId: false,
      hasClientSecret: false,
      hasUsername: false,
      hasPassword: false,
      organisationId: null,
      groupIds: [] as number[],
      credentialScope: 'OPERATOR' as const,
      shared: false,
      syncEnabled: true,
      syncCron: '0 */6 * * *',
      historyDays: 7,
      streamEnabled: true,
      streamIntervalSeconds: 30,
      streamQuantity: 1000,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
    };
  }
  return {
    configured: Boolean(row.client_id_enc && row.client_secret_enc && row.username_enc && row.password_enc),
    region: row.region,
    identityUrl: row.identity_url,
    apiUrl: row.api_url,
    scope: row.scope,
    hasClientId: Boolean(row.client_id_enc),
    hasClientSecret: Boolean(row.client_secret_enc),
    hasUsername: Boolean(row.username_enc),
    hasPassword: Boolean(row.password_enc),
    organisationId: row.organisation_id,
    groupIds: row.group_ids ?? [],
    credentialScope: row.credential_scope,
    shared,
    syncEnabled: row.sync_enabled,
    syncCron: row.sync_cron,
    historyDays: row.history_days,
    streamEnabled: row.stream_enabled,
    streamIntervalSeconds: row.stream_interval_seconds,
    streamQuantity: row.stream_quantity,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
  };
}

/**
 * Grava as credenciais. Campos de segredo em branco/ausentes preservam o valor atual —
 * por isso a UI pode exibir os campos vazios sem risco de apagar o que já está salvo.
 */
export async function saveCredentials(
  organizationId: string,
  operatorId: string | null,
  input: CredentialsInput,
): Promise<IntegrationCredentialRow> {
  const credentialScope = input.credentialScope ?? (operatorId ? 'OPERATOR' : 'ORGANIZATION');
  const effectiveOperatorId = credentialScope === 'ORGANIZATION' ? null : operatorId;
  const current = effectiveOperatorId
    ? await getCredentialRow(effectiveOperatorId)
    : await getSharedCredentialRow(organizationId);
  const preset = TRACK7_REGIONS[input.region] ?? TRACK7_REGIONS.us;

  const identityUrl = input.identityUrl?.trim() || (input.region !== current?.region ? preset.identityUrl : current?.identity_url) || preset.identityUrl;
  const apiUrl = input.apiUrl?.trim() || (input.region !== current?.region ? preset.apiUrl : current?.api_url) || preset.apiUrl;
  const scope = input.scope?.trim() || current?.scope || 'offline_access MiX.Integrate';

  const keep = (incoming: string | undefined, existing: string | null | undefined) =>
    incoming && incoming.trim().length > 0 ? encryptSecret(incoming.trim()) : (existing ?? null);

  const organisationId =
    input.organisationId === undefined
      ? (current?.organisation_id ?? null)
      : input.organisationId === null || input.organisationId === ''
        ? null
        : Number(input.organisationId);

  const groupIds =
    input.groupIds === undefined
      ? (current?.group_ids ?? [])
      : input.groupIds.map((g) => Number(g)).filter((g) => Number.isFinite(g));

  const row = await one<IntegrationCredentialRow>(
    `INSERT INTO integration_credentials
       (organization_id, operator_id, provider, region, identity_url, api_url, scope,
        client_id_enc, client_secret_enc, username_enc, password_enc,
        organisation_id, group_ids, sync_enabled, sync_cron, history_days,
        stream_enabled, stream_interval_seconds, stream_quantity, credential_scope, updated_at)
     VALUES ($1,$2,'track7',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     ON CONFLICT ${effectiveOperatorId ? '(operator_id, provider) WHERE operator_id IS NOT NULL' : '(organization_id, provider) WHERE operator_id IS NULL'} DO UPDATE SET
        region = EXCLUDED.region,
        identity_url = EXCLUDED.identity_url,
        api_url = EXCLUDED.api_url,
        scope = EXCLUDED.scope,
        client_id_enc = EXCLUDED.client_id_enc,
        client_secret_enc = EXCLUDED.client_secret_enc,
        username_enc = EXCLUDED.username_enc,
        password_enc = EXCLUDED.password_enc,
        organisation_id = EXCLUDED.organisation_id,
        group_ids = EXCLUDED.group_ids,
        sync_enabled = EXCLUDED.sync_enabled,
        sync_cron = EXCLUDED.sync_cron,
        history_days = EXCLUDED.history_days,
        stream_enabled = EXCLUDED.stream_enabled,
        stream_interval_seconds = EXCLUDED.stream_interval_seconds,
        stream_quantity = EXCLUDED.stream_quantity,
        credential_scope = EXCLUDED.credential_scope,
        updated_at = now()
     RETURNING *`,
    [
      organizationId,
      effectiveOperatorId,
      input.region ?? current?.region ?? 'us',
      identityUrl,
      apiUrl,
      scope,
      keep(input.clientId, current?.client_id_enc),
      keep(input.clientSecret, current?.client_secret_enc),
      keep(input.username, current?.username_enc),
      keep(input.password, current?.password_enc),
      organisationId,
      groupIds,
      input.syncEnabled ?? current?.sync_enabled ?? true,
      input.syncCron ?? current?.sync_cron ?? '0 */6 * * *',
      input.historyDays ?? current?.history_days ?? 7,
      input.streamEnabled ?? current?.stream_enabled ?? true,
      input.streamIntervalSeconds ?? current?.stream_interval_seconds ?? 30,
      input.streamQuantity ?? current?.stream_quantity ?? 1000,
      credentialScope,
    ],
  );
  return row!;
}

export interface ResolvedCredentials {
  row: IntegrationCredentialRow;
  client: Track7Client;
  operator: OperatorRow;
  /** true quando veio da credencial compartilhada da conta. */
  shared: boolean;
}

/** Monta o cliente da Track7 a partir das credenciais cifradas da organização. */
export async function buildClient(operatorId: string): Promise<ResolvedCredentials> {
  const operator = await getOperatorById(operatorId);
  const resolved = await resolveCredential(operator);
  if (!resolved) {
    throw badRequest(
      `Integração Track7 não configurada para "${operator.name}" — cadastre chaves próprias ou uma credencial compartilhada da conta.`,
    );
  }
  const { row, shared } = resolved;

  const clientId = decryptSecret(row.client_id_enc);
  const clientSecret = decryptSecret(row.client_secret_enc);
  const username = decryptSecret(row.username_enc);
  const password = decryptSecret(row.password_enc);

  const missing = [
    !clientId && 'Client ID',
    !clientSecret && 'Client Secret',
    !username && 'Usuário',
    !password && 'Senha',
  ].filter(Boolean);
  if (missing.length) {
    throw badRequest(`Credenciais da Track7 incompletas: ${missing.join(', ')}.`);
  }

  return {
    row,
    operator,
    shared,
    client: new Track7Client({
      identityUrl: row.identity_url,
      apiUrl: row.api_url,
      scope: row.scope,
      clientId: clientId!,
      clientSecret: clientSecret!,
      username: username!,
      password: password!,
    }),
  };
}

/** Cliente temporário a partir de um payload (usado no "Testar conexão" antes de salvar). */
export async function buildEphemeralClient(
  organizationId: string,
  operatorId: string | null,
  input: CredentialsInput,
): Promise<Track7Client> {
  const current = operatorId
    ? ((await getCredentialRow(operatorId)) ?? (await getSharedCredentialRow(organizationId)))
    : await getSharedCredentialRow(organizationId);
  const preset = TRACK7_REGIONS[input.region] ?? TRACK7_REGIONS.us;
  const pick = (incoming: string | undefined, encrypted: string | null | undefined) =>
    incoming && incoming.trim() ? incoming.trim() : decryptSecret(encrypted);

  const clientId = pick(input.clientId, current?.client_id_enc);
  const clientSecret = pick(input.clientSecret, current?.client_secret_enc);
  const username = pick(input.username, current?.username_enc);
  const password = pick(input.password, current?.password_enc);

  const missing = [
    !clientId && 'Client ID',
    !clientSecret && 'Client Secret',
    !username && 'Usuário',
    !password && 'Senha',
  ].filter(Boolean);
  if (missing.length) throw badRequest(`Informe: ${missing.join(', ')}.`);

  return new Track7Client({
    identityUrl: input.identityUrl?.trim() || current?.identity_url || preset.identityUrl,
    apiUrl: input.apiUrl?.trim() || current?.api_url || preset.apiUrl,
    scope: input.scope?.trim() || current?.scope || 'offline_access MiX.Integrate',
    clientId: clientId!,
    clientSecret: clientSecret!,
    username: username!,
    password: password!,
  });
}

/**
 * Marca o resultado na credencial da operadora. Com credencial compartilhada
 * não há linha por operadora, então o histórico fica em sync_runs.
 */
export async function markSyncResult(
  operatorId: string,
  status: string,
  error: string | null,
): Promise<void> {
  await query(
    `UPDATE integration_credentials
        SET last_sync_at = now(), last_sync_status = $2, last_sync_error = $3
      WHERE operator_id = $1 AND provider = 'track7'`,
    [operatorId, status, error],
  );
}
