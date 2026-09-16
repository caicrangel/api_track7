-- ============================================================
-- Credencial compartilhada do consórcio
--
-- Na plataforma da Track7 (MiX), um mesmo login pode enxergar várias
-- organizações — api/organisationgroups devolve uma lista. Isso permite
-- dois modos de operação:
--
--   · credencial por operadora  → cada empresa com o próprio jogo de chaves
--   · credencial compartilhada  → um acesso do consórcio atende todas
--
-- Para suportar os dois, o identificador da organização na Track7 passa a
-- ser atributo da OPERADORA (é a identidade dela na plataforma), e não da
-- credencial. A credencial vira opcionalmente compartilhada pela conta.
-- ============================================================

-- ─── A identidade da operadora na plataforma ───────────────
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS track7_organisation_id bigint,
  ADD COLUMN IF NOT EXISTS track7_group_ids bigint[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN operators.track7_organisation_id IS
  'GroupId da organização desta empresa na Track7 (api/organisationgroups).';
COMMENT ON COLUMN operators.track7_group_ids IS
  'Grupos/sites a consultar. Vazio = a organização inteira.';

-- Herda o que já estava na credencial de cada operadora.
-- Duas operadoras não podem apontar para a mesma organização da Track7 (seria
-- ambíguo); em caso de empate, só a primeira herda e as demais ficam para ser
-- resolvidas pela descoberta.
WITH ranked AS (
  SELECT op.id AS operator_id,
         c.organisation_id,
         c.group_ids,
         row_number() OVER (
           PARTITION BY op.organization_id, c.organisation_id ORDER BY op.created_at
         ) AS rn
    FROM operators op
    JOIN integration_credentials c ON c.operator_id = op.id
   WHERE c.organisation_id IS NOT NULL
)
UPDATE operators op
   SET track7_organisation_id = ranked.organisation_id,
       track7_group_ids = coalesce(ranked.group_ids, '{}')
  FROM ranked
 WHERE ranked.operator_id = op.id
   AND ranked.rn = 1
   AND op.track7_organisation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operators_org_track7_uidx
  ON operators (organization_id, track7_organisation_id)
  WHERE track7_organisation_id IS NOT NULL;

-- ─── A credencial pode ser da conta, não de uma operadora ──
ALTER TABLE integration_credentials
  ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'OPERATOR'
    CHECK (scope IN ('OPERATOR', 'ORGANIZATION'));

COMMENT ON COLUMN integration_credentials.scope IS
  'OPERATOR: chaves próprias da empresa. ORGANIZATION: acesso único do consórcio, válido para todas.';

-- A restrição antiga não cobre credencial sem operadora
ALTER TABLE integration_credentials
  DROP CONSTRAINT IF EXISTS integration_credentials_operator_provider_key;

CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_operator_uidx
  ON integration_credentials (operator_id, provider)
  WHERE operator_id IS NOT NULL;

-- Uma credencial compartilhada por conta e fornecedor
CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_shared_uidx
  ON integration_credentials (organization_id, provider)
  WHERE operator_id IS NULL;

-- A FK precisa aceitar nulo
ALTER TABLE integration_credentials DROP CONSTRAINT IF EXISTS integration_credentials_operator_fk;
ALTER TABLE integration_credentials
  ADD CONSTRAINT integration_credentials_operator_fk
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE;
