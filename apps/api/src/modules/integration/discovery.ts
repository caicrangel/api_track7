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
import { bigId } from '../../lib/big-id.js';

export interface DiscoveredOrganisation {
  groupId: string;
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
  /** Operadoras que deixaram de aparecer na API — sinalizadas, nunca apagadas. */
  missing: Array<{ operatorId: string; name: string }>;
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

  const existing = await rows<{ id: string; name: string; track7_organisation_id: number | string | null }>(
    `SELECT id, name, track7_organisation_id FROM operators WHERE organization_id = $1`,
    [organizationId],
  );

  const byOrganisation = new Map(
    existing.filter((o) => o.track7_organisation_id != null).map((o) => [bigId(o.track7_organisation_id)!, o]),
  );
  const byName = new Map(existing.map((o) => [normalize(o.name), o]));

  const organisations: DiscoveredOrganisation[] = [];
  const seenOperatorIds = new Set<string>();
  let created = 0;
  let linked = 0;

  for (const group of groups) {
    const groupId = bigId(group.GroupId);
    if (!groupId) continue;
    const name = group.Name?.trim() || `Organização ${groupId}`;

    const alreadyLinked = byOrganisation.get(groupId);
    if (alreadyLinked) {
      seenOperatorIds.add(alreadyLinked.id);
      if (options.apply) await markSeen(alreadyLinked.id);
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
      seenOperatorIds.add(sameName.id);
      if (options.apply) {
        await query(
          `UPDATE operators
              SET track7_organisation_id = $2, api_visible = true, api_last_seen_at = now(), updated_at = now()
            WHERE id = $1`,
          [sameName.id, groupId],
        );
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
        `INSERT INTO operators
           (organization_id, name, short_name, track7_organisation_id, source, api_visible, api_last_seen_at)
         VALUES ($1, $2, $2, $3, 'DESCOBERTA', true, now())
         RETURNING id`,
        [organizationId, name, groupId],
      );
      created += 1;
      if (inserted) seenOperatorIds.add(inserted.id);
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

  // O que estava vinculado e não apareceu desta vez fica sinalizado.
  // Apagar seria destruir histórico por uma indisponibilidade momentânea.
  const missing = existing
    .filter((o) => o.track7_organisation_id != null && !seenOperatorIds.has(o.id))
    .map((o) => ({ operatorId: o.id, name: o.name }));

  if (options.apply && missing.length) {
    await query(
      `UPDATE operators SET api_visible = false, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [missing.map((m) => m.operatorId)],
    );
  }

  return { organisations, created, linked, missing };
}

async function markSeen(operatorId: string): Promise<void> {
  await query(
    `UPDATE operators SET api_visible = true, api_last_seen_at = now(), updated_at = now() WHERE id = $1`,
    [operatorId],
  );
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
