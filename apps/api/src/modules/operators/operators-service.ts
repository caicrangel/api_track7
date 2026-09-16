/**
 * Empresas operadoras.
 *
 * Uma organização (a conta do consórcio) agrupa várias operadoras, e cada
 * operadora tem as próprias credenciais da Track7, o próprio coletor de
 * posições e os próprios veículos. É a unidade de individualização que o
 * órgão gestor exige nas alíneas (a) e (h) do ofício.
 */
import { one, rows } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';

export interface OperatorRow {
  id: string;
  organization_id: string;
  name: string;
  /** Identidade da empresa na plataforma da Track7. */
  track7_organisation_id: number | null;
  track7_group_ids: number[];
  source: 'MANUAL' | 'DESCOBERTA';
  api_visible: boolean;
  api_last_seen_at: Date | null;
  short_name: string | null;
  code: string | null;
  document: string | null;
  provider: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export async function listOperators(
  organizationId: string,
  options: { includeInactive?: boolean } = {},
): Promise<OperatorRow[]> {
  return rows<OperatorRow>(
    `SELECT * FROM operators
      WHERE organization_id = $1
        AND ($2::boolean OR status = 'ACTIVE')
      ORDER BY name`,
    [organizationId, options.includeInactive ?? false],
  );
}

/** Busca só pelo id — para uso interno, quando a conta já foi validada. */
export async function getOperatorById(operatorId: string): Promise<OperatorRow> {
  const operator = await one<OperatorRow>(`SELECT * FROM operators WHERE id = $1`, [operatorId]);
  if (!operator) throw notFound('Empresa operadora não encontrada.');
  return operator;
}

export async function getOperator(organizationId: string, operatorId: string): Promise<OperatorRow> {
  const operator = await one<OperatorRow>(
    `SELECT * FROM operators WHERE id = $1 AND organization_id = $2`,
    [operatorId, organizationId],
  );
  if (!operator) throw notFound('Empresa operadora não encontrada.');
  return operator;
}

/**
 * Resolve qual operadora a requisição deve usar.
 *
 * Sem `operatorId` e com uma única operadora cadastrada, assume essa —
 * é o que mantém o sistema simples enquanto houver só uma empresa.
 * Com várias, exige escolha explícita nas ações que gravam dados.
 */
export async function resolveOperator(
  organizationId: string,
  operatorId?: string | null,
): Promise<OperatorRow> {
  if (operatorId) return getOperator(organizationId, operatorId);

  const operators = await listOperators(organizationId);
  if (operators.length === 1) return operators[0];
  if (operators.length === 0) {
    throw badRequest('Nenhuma empresa operadora cadastrada. Cadastre uma em Configurações › Operadoras.');
  }
  throw badRequest('Selecione a empresa operadora — há mais de uma cadastrada nesta conta.');
}

/**
 * Escopo de leitura: uma operadora específica, ou todas as da organização
 * (visão consolidada do consórcio).
 */
export async function resolveOperatorScope(
  organizationId: string,
  operatorId?: string | null,
): Promise<string[]> {
  if (operatorId) {
    const operator = await getOperator(organizationId, operatorId);
    return [operator.id];
  }
  const operators = await listOperators(organizationId, { includeInactive: true });
  return operators.map((o) => o.id);
}
