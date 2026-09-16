-- ============================================================
-- Correção: `scope` já era o escopo OAuth da credencial
-- ("offline_access MiX.Integrate"). O alcance da credencial precisa
-- de coluna própria para não confundir os dois conceitos.
-- ============================================================

ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS credential_scope text NOT NULL DEFAULT 'OPERATOR';

-- Credencial sem operadora é, por definição, compartilhada pela conta
UPDATE integration_credentials
   SET credential_scope = CASE WHEN operator_id IS NULL THEN 'ORGANIZATION' ELSE 'OPERATOR' END;

ALTER TABLE integration_credentials
  DROP CONSTRAINT IF EXISTS integration_credentials_credential_scope_check;
ALTER TABLE integration_credentials
  ADD CONSTRAINT integration_credentials_credential_scope_check
  CHECK (credential_scope IN ('OPERATOR', 'ORGANIZATION'));

-- Coerência entre o alcance e a presença da operadora
ALTER TABLE integration_credentials
  DROP CONSTRAINT IF EXISTS integration_credentials_scope_operator_check;
ALTER TABLE integration_credentials
  ADD CONSTRAINT integration_credentials_scope_operator_check
  CHECK (
    (credential_scope = 'OPERATOR' AND operator_id IS NOT NULL) OR
    (credential_scope = 'ORGANIZATION' AND operator_id IS NULL)
  );

COMMENT ON COLUMN integration_credentials.credential_scope IS
  'OPERATOR: chaves próprias da empresa. ORGANIZATION: acesso único do consórcio, válido para todas as operadoras.';
COMMENT ON COLUMN integration_credentials.scope IS
  'Escopo OAuth enviado ao Identity Server (offline_access MiX.Integrate).';
