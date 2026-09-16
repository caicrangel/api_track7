/**
 * Descoberta de operadoras a partir das credenciais da Track7.
 *
 * `api/organisationgroups` devolve todas as organizações que o login enxerga.
 * Com uma credencial do consórcio, é essa lista que revela as empresas —
 * cada organização vira (ou é vinculada a) uma empresa operadora aqui.
 */
import { one, query, rows } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';
import { buildEphemeralClient, getSharedCredentialRow, type CredentialsInput } from './credentials.js';
import type { Track7Group } from './track7-client.js';

export interface DiscoveredOrganisation {
  groupId: number;
  name: string;
  /** já vinculada · nova · em conflito com outra operadora */
  status: 'linked' | 'new' | 'conflict';
  operatorId: string | null;
  operatorName: string | null;
}

export interface DiscoveryResult {
  organisations: DiscoveredOrganisation[];
  created: number;
  linked: number;
}

/**
 * Lista as organizações visíveis e compara com as operadoras já cadastradas.
 * Com `apply`, cria as que faltam e vincula as existentes por nome.
 */
export async function discoverOperators(
  organizationId: string,
  options: { apply?: boolean; input?: CredentialsInput } = {},
): Promise<DiscoveryResult> {
  const shared = await getSharedCredentialRow(organizationId);
  if (!shared?.client_id_enc && !options.input?.clientId) {
    throw badRequest(
      'Cadastre a credencial compartilhada da conta antes de descobrir as operadoras.',
    );
  }

  const client = await buildEphemeralClient(organizationId, null, {
    region: shared?.region ?? 'us',
    ...options.input,
  });

  let groups: Track7Group[];
  try {
    groups = await client.getOrganisationGroups();
  } catch (err) {
    throw badRequest(`Não foi possível listar as organizações: ${(err as Error).message}`);
  }
  if (!groups.length) throw badRequest('Nenhuma organização visível para estas credenciais.');

  const existing = await rows<{ id: string; name: string; track7_organisation_id: number | null }>(
    `SELECT id, name, track7_organisation_id FROM operators WHERE organization_id = $1`,
    [organizationId],
  );

  const byOrganisation = new Map(
    existing.filter((o) => o.track7_organisation_id != null).map((o) => [Number(o.track7_organisation_id), o]),
  );
  const byName = new Map(existing.map((o) => [normalize(o.name), o]));

  const organisations: DiscoveredOrganisation[] = [];
  let created = 0;
  let linked = 0;

  for (const group of groups) {
    const groupId = Number(group.GroupId);
    const name = group.Name?.trim() || `Organização ${groupId}`;

    const alreadyLinked = byOrganisation.get(groupId);
    if (alreadyLinked) {
      organisations.push({
        groupId,
        name,
        status: 'linked',
        operatorId: alreadyLinked.id,
        operatorName: alreadyLinked.name,
      });
      continue;
    }

    // uma operadora cadastrada com o mesmo nome, ainda sem vínculo
    const sameName = byName.get(normalize(name));
    if (sameName && sameName.track7_organisation_id == null) {
      if (options.apply) {
        await query(`UPDATE operators SET track7_organisation_id = $2, updated_at = now() WHERE id = $1`, [
          sameName.id,
          groupId,
        ]);
        byOrganisation.set(groupId, { ...sameName, track7_organisation_id: groupId });
        linked += 1;
      }
      organisations.push({
        groupId,
        name,
        status: 'linked',
        operatorId: sameName.id,
        operatorName: sameName.name,
      });
      continue;
    }

    if (sameName) {
      organisations.push({
        groupId,
        name,
        status: 'conflict',
        operatorId: sameName.id,
        operatorName: sameName.name,
      });
      continue;
    }

    if (options.apply) {
      const inserted = await one<{ id: string }>(
        `INSERT INTO operators (organization_id, name, short_name, track7_organisation_id)
         VALUES ($1, $2, $2, $3) RETURNING id`,
        [organizationId, name, groupId],
      );
      created += 1;
      organisations.push({
        groupId,
        name,
        status: 'new',
        operatorId: inserted?.id ?? null,
        operatorName: name,
      });
    } else {
      organisations.push({ groupId, name, status: 'new', operatorId: null, operatorName: null });
    }
  }

  return { organisations, created, linked };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
