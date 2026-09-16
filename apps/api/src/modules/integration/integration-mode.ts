/**
 * Modo de integração da conta.
 *
 *   POR_OPERADORA → cada empresa cadastra as próprias credenciais da Track7
 *   CONSORCIO     → um único acesso da conta; as empresas são derivadas das
 *                   organizações que esse acesso enxerga na API
 *
 * A troca é cercada: só administrador, só com credencial que autentica de
 * verdade, e com registro de quem mudou e quando. As credenciais individuais
 * nunca são apagadas — voltar atrás precisa ser possível.
 */
import { one, query } from '../../db/pool.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { buildEphemeralClient, getSharedCredentialRow } from './credentials.js';

export type IntegrationMode = 'POR_OPERADORA' | 'CONSORCIO';

export interface IntegrationModeState {
  mode: IntegrationMode;
  changedAt: Date | null;
  changedByName: string | null;
  /** Pré-requisitos para ligar o modo consórcio. */
  canEnableConsortium: boolean;
  blockers: string[];
  sharedConfigured: boolean;
  operatorsWithOwnCredentials: number;
}

export async function getIntegrationMode(organizationId: string): Promise<IntegrationMode> {
  const row = await one<{ integration_mode: IntegrationMode }>(
    `SELECT integration_mode FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return row?.integration_mode ?? 'POR_OPERADORA';
}

export async function getIntegrationModeState(organizationId: string): Promise<IntegrationModeState> {
  const row = await one<{
    integration_mode: IntegrationMode;
    integration_mode_changed_at: Date | null;
    changed_by_name: string | null;
  }>(
    `SELECT o.integration_mode, o.integration_mode_changed_at, u.name AS changed_by_name
       FROM organizations o
       LEFT JOIN users u ON u.id = o.integration_mode_changed_by
      WHERE o.id = $1`,
    [organizationId],
  );

  const shared = await getSharedCredentialRow(organizationId);
  const sharedConfigured = Boolean(
    shared?.client_id_enc && shared?.client_secret_enc && shared?.username_enc && shared?.password_enc,
  );

  const own = await one<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM integration_credentials c
       JOIN operators op ON op.id = c.operator_id
      WHERE op.organization_id = $1 AND c.client_id_enc IS NOT NULL`,
    [organizationId],
  );

  const blockers: string[] = [];
  if (!sharedConfigured) {
    blockers.push('Cadastre o acesso único da conta (Client ID, Client Secret, usuário e senha).');
  }

  return {
    mode: row?.integration_mode ?? 'POR_OPERADORA',
    changedAt: row?.integration_mode_changed_at ?? null,
    changedByName: row?.changed_by_name ?? null,
    canEnableConsortium: blockers.length === 0,
    blockers,
    sharedConfigured,
    operatorsWithOwnCredentials: own?.count ?? 0,
  };
}

/**
 * Troca o modo. Ligar o consórcio exige que a credencial da conta realmente
 * autentique e enxergue ao menos uma organização — não basta estar preenchida.
 */
export async function setIntegrationMode(
  organizationId: string,
  mode: IntegrationMode,
  userId: string,
): Promise<{ mode: IntegrationMode; organisationsVisible: number | null }> {
  const current = await getIntegrationMode(organizationId);
  if (current === mode) return { mode, organisationsVisible: null };

  let organisationsVisible: number | null = null;

  if (mode === 'CONSORCIO') {
    const shared = await getSharedCredentialRow(organizationId);
    if (!shared?.client_id_enc) {
      throw badRequest(
        'Cadastre o acesso único da conta antes de ligar o modo consórcio.',
      );
    }

    // valida de verdade: credencial preenchida não é credencial que funciona
    const client = await buildEphemeralClient(organizationId, null, { region: shared.region });
    const groups = await client.getOrganisationGroups();
    if (!groups.length) {
      throw badRequest('O acesso da conta não enxerga nenhuma organização na Track7.');
    }
    organisationsVisible = groups.length;
  }

  await query(
    `UPDATE organizations
        SET integration_mode = $2,
            integration_mode_changed_at = now(),
            integration_mode_changed_by = $3,
            updated_at = now()
      WHERE id = $1`,
    [organizationId, mode, userId],
  );

  return { mode, organisationsVisible };
}

/**
 * Trava as credenciais por operadora quando a conta está em modo consórcio.
 * Guardar chaves individuais nesse modo só criaria confusão sobre qual vale.
 */
export async function assertPerOperatorCredentialsAllowed(organizationId: string): Promise<void> {
  const mode = await getIntegrationMode(organizationId);
  if (mode === 'CONSORCIO') {
    throw forbidden(
      'A conta está em modo consórcio: as credenciais vêm do acesso único. ' +
        'Para cadastrar chaves por empresa, volte o modo para "por operadora" em Configurações › Integrações.',
    );
  }
}
