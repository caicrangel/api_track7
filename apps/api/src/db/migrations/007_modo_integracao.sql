-- ============================================================
-- Modo de integração da conta
--
--   POR_OPERADORA : cada empresa cadastra as próprias credenciais
--   CONSORCIO     : um único acesso da conta; as empresas são derivadas
--                   das organizações que esse acesso enxerga na Track7
--
-- No modo CONSORCIO o sistema deixa de pedir credencial empresa por
-- empresa: as credenciais individuais passam a ser ignoradas — não são
-- apagadas, para que voltar atrás seja sempre possível.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS integration_mode text NOT NULL DEFAULT 'POR_OPERADORA',
  ADD COLUMN IF NOT EXISTS integration_mode_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS integration_mode_changed_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_integration_mode_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_integration_mode_check
  CHECK (integration_mode IN ('POR_OPERADORA', 'CONSORCIO'));

COMMENT ON COLUMN organizations.integration_mode IS
  'POR_OPERADORA: credenciais individuais. CONSORCIO: acesso único da conta, empresas derivadas da API.';

-- ─── Origem e visibilidade da operadora ────────────────────
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS api_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS api_last_seen_at timestamptz;

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_source_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_source_check CHECK (source IN ('MANUAL', 'DESCOBERTA'));

COMMENT ON COLUMN operators.source IS
  'MANUAL: cadastrada à mão. DESCOBERTA: criada a partir das organizações visíveis na API.';
COMMENT ON COLUMN operators.api_visible IS
  'False quando a organização deixou de aparecer na API. Nunca apagamos dados por isso — só sinalizamos.';

-- Quem já está vinculada a uma organização foi vista na API
UPDATE operators
   SET api_last_seen_at = now()
 WHERE track7_organisation_id IS NOT NULL
   AND api_last_seen_at IS NULL;

-- ─── Reconciliação periódica no modo consórcio ─────────────
ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discovery_interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS last_discovery_at timestamptz;

COMMENT ON COLUMN integration_credentials.discovery_enabled IS
  'No modo consórcio, mantém a lista de empresas em dia com a API automaticamente.';
