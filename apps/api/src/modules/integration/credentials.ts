import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { Track7Client, TRACK7_REGIONS } from './track7-client.js';

export interface IntegrationCredentialRow {
  id: string;
  organization_id: string;
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
  syncEnabled: z.boolean().optional(),
  syncCron: z.string().optional(),
  historyDays: z.number().int().min(1).max(90).optional(),
});

export type CredentialsInput = z.infer<typeof credentialsInputSchema>;

export async function getCredentialRow(organizationId: string): Promise<IntegrationCredentialRow | null> {
  return one<IntegrationCredentialRow>(
    `SELECT * FROM integration_credentials WHERE organization_id = $1 AND provider = 'track7'`,
    [organizationId],
  );
}

/** Versão segura para a UI — nunca devolve segredos, apenas se estão preenchidos. */
export function toPublicView(row: IntegrationCredentialRow | null) {
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
      syncEnabled: true,
      syncCron: '0 */6 * * *',
      historyDays: 7,
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
    syncEnabled: row.sync_enabled,
    syncCron: row.sync_cron,
    historyDays: row.history_days,
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
  input: CredentialsInput,
): Promise<IntegrationCredentialRow> {
  const current = await getCredentialRow(organizationId);
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
       (organization_id, provider, region, identity_url, api_url, scope,
        client_id_enc, client_secret_enc, username_enc, password_enc,
        organisation_id, group_ids, sync_enabled, sync_cron, history_days, updated_at)
     VALUES ($1,'track7',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (organization_id, provider) DO UPDATE SET
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
        updated_at = now()
     RETURNING *`,
    [
      organizationId,
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
    ],
  );
  return row!;
}

export interface ResolvedCredentials {
  row: IntegrationCredentialRow;
  client: Track7Client;
}

/** Monta o cliente da Track7 a partir das credenciais cifradas da organização. */
export async function buildClient(organizationId: string): Promise<ResolvedCredentials> {
  const row = await getCredentialRow(organizationId);
  if (!row) throw badRequest('Integração Track7 ainda não configurada.');

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
  input: CredentialsInput,
): Promise<Track7Client> {
  const current = await getCredentialRow(organizationId);
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

export async function markSyncResult(
  organizationId: string,
  status: string,
  error: string | null,
): Promise<void> {
  await query(
    `UPDATE integration_credentials
        SET last_sync_at = now(), last_sync_status = $2, last_sync_error = $3
      WHERE organization_id = $1 AND provider = 'track7'`,
    [organizationId, status, error],
  );
}
