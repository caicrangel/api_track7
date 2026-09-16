-- ============================================================
-- Empresas operadoras (multi-operadora)
--
-- Hierarquia: organização (conta) → operadoras → dados de telemetria.
-- Cada operadora tem as próprias credenciais da Track7, o próprio
-- ponteiro do fluxo de posições e o próprio coletor.
--
-- Atende também o Ofício DGOD/TRANSFACIL 001/2026:
--   alínea (a) relação empresa operadora ↔ fornecedor de telemetria
--   alínea (h) arquivos individualizados por empresa operadora
-- ============================================================

CREATE TABLE IF NOT EXISTS operators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  short_name      text,
  code            text,
  document        text,
  provider        text NOT NULL DEFAULT 'track7',
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  notes           text,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operators_org_idx ON operators (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS operators_org_code_uidx
  ON operators (organization_id, lower(code)) WHERE code IS NOT NULL;

COMMENT ON TABLE operators IS
  'Empresas operadoras. Cada uma com credenciais próprias da Track7 — é a unidade de individualização exigida pelo órgão gestor.';
COMMENT ON COLUMN operators.provider IS 'Fornecedor de telemetria — hoje sempre track7 (alínea "a" do ofício).';

-- ─── Operadora padrão para os dados já existentes ──────────
INSERT INTO operators (organization_id, name, short_name, status)
SELECT o.id, o.name, o.name, 'ACTIVE'
  FROM organizations o
 WHERE NOT EXISTS (SELECT 1 FROM operators op WHERE op.organization_id = o.id);

-- ─── Propaga operator_id ───────────────────────────────────
DO $$
DECLARE
  t text;
  telemetry_tables text[] := ARRAY[
    'integration_credentials','sync_runs','stream_cursors','t7_groups','t7_event_types',
    'drivers','vehicles','vehicle_last_position','positions','trips','telemetry_events'
  ];
BEGIN
  FOREACH t IN ARRAY telemetry_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS operator_id uuid', t);
    EXECUTE format(
      'UPDATE %I x SET operator_id = (
         SELECT op.id FROM operators op WHERE op.organization_id = x.organization_id
          ORDER BY op.created_at LIMIT 1)
       WHERE x.operator_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN operator_id SET NOT NULL', t);
  END LOOP;
END $$;

-- report_executions guarda a operadora quando o relatório for individualizado
ALTER TABLE report_executions ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES operators(id) ON DELETE SET NULL;

-- ─── Chaves e restrições passam a ser por operadora ────────

-- credenciais: uma por operadora e fornecedor
ALTER TABLE integration_credentials DROP CONSTRAINT IF EXISTS integration_credentials_organization_id_provider_key;
ALTER TABLE integration_credentials
  ADD CONSTRAINT integration_credentials_operator_provider_key UNIQUE (operator_id, provider);

-- ponteiro do fluxo: um por operadora
ALTER TABLE stream_cursors DROP CONSTRAINT IF EXISTS stream_cursors_pkey;
ALTER TABLE stream_cursors ADD PRIMARY KEY (operator_id, provider, stream);

-- catálogo e telemetria: identidade da Track7 é única dentro da operadora
ALTER TABLE t7_groups        DROP CONSTRAINT IF EXISTS t7_groups_pkey;
ALTER TABLE t7_groups        ADD PRIMARY KEY (operator_id, group_id);

ALTER TABLE t7_event_types   DROP CONSTRAINT IF EXISTS t7_event_types_pkey;
ALTER TABLE t7_event_types   ADD PRIMARY KEY (operator_id, event_type_id);

ALTER TABLE drivers          DROP CONSTRAINT IF EXISTS drivers_pkey;
ALTER TABLE drivers          ADD PRIMARY KEY (operator_id, driver_id);

ALTER TABLE vehicles         DROP CONSTRAINT IF EXISTS vehicles_pkey;
ALTER TABLE vehicles         ADD PRIMARY KEY (operator_id, asset_id);

ALTER TABLE vehicle_last_position DROP CONSTRAINT IF EXISTS vehicle_last_position_pkey;
ALTER TABLE vehicle_last_position ADD PRIMARY KEY (operator_id, asset_id);

ALTER TABLE trips            DROP CONSTRAINT IF EXISTS trips_pkey;
ALTER TABLE trips            ADD PRIMARY KEY (operator_id, trip_id);

ALTER TABLE telemetry_events DROP CONSTRAINT IF EXISTS telemetry_events_pkey;
ALTER TABLE telemetry_events ADD PRIMARY KEY (operator_id, event_id);

-- positions é particionada: a chave precisa conter a coluna de partição
ALTER TABLE positions        DROP CONSTRAINT IF EXISTS positions_pkey;
ALTER TABLE positions        ADD PRIMARY KEY (operator_id, recorded_at, position_id);

-- ─── Chaves estrangeiras para a operadora ──────────────────
DO $$
DECLARE
  t text;
  fk_tables text[] := ARRAY[
    'integration_credentials','sync_runs','stream_cursors','t7_groups','t7_event_types',
    'drivers','vehicles','vehicle_last_position','trips','telemetry_events'
  ];
BEGIN
  FOREACH t IN ARRAY fk_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE',
      t, t || '_operator_fk');
  END LOOP;
END $$;
-- positions fica sem FK de propósito: é a tabela de maior volume e a
-- verificação por linha custaria caro na ingestão contínua.

-- ─── Índices das consultas por operadora ───────────────────
CREATE INDEX IF NOT EXISTS vehicles_operator_idx        ON vehicles (operator_id, description);
CREATE INDEX IF NOT EXISTS drivers_operator_idx         ON drivers (operator_id, name);
CREATE INDEX IF NOT EXISTS positions_operator_time_idx  ON positions (operator_id, asset_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS trips_operator_start_idx     ON trips (operator_id, trip_start DESC);
CREATE INDEX IF NOT EXISTS events_operator_start_idx    ON telemetry_events (operator_id, start_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_operator_idx       ON sync_runs (operator_id, started_at DESC);
