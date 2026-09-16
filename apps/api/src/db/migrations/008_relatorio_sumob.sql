-- ============================================================
-- Relatório georreferenciado de viagem (SMMUR/SUMOB)
--
-- Ofício DGOD/TRANSFACIL 001/2026, alínea (c): cada registro precisa de
-- número de ordem do veículo, data, hora, latitude e longitude.
--
-- Guarda também a evidência de integridade de cada arquivo emitido —
-- as alíneas (e), (f) e (g) proíbem qualquer alteração manual, e um hash
-- do conteúdo torna isso demonstrável.
-- ============================================================

CREATE TABLE IF NOT EXISTS sumob_exports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operator_id       uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  trip_external_id  text NOT NULL,
  asset_id          bigint NOT NULL,
  vehicle_order     text,
  period_from       timestamptz NOT NULL,
  period_to         timestamptz NOT NULL,
  decendio          text NOT NULL,
  format            text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  file_name         text NOT NULL,
  row_count         integer NOT NULL DEFAULT 0,
  content_sha256    text NOT NULL,
  byte_size         integer NOT NULL DEFAULT 0,
  timezone          text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sumob_exports_org_idx ON sumob_exports (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sumob_exports_trip_idx ON sumob_exports (organization_id, trip_external_id);
CREATE INDEX IF NOT EXISTS sumob_exports_decendio_idx ON sumob_exports (operator_id, decendio);

COMMENT ON TABLE sumob_exports IS
  'Registro de cada arquivo emitido para contestação: o que foi extraído, quando e com que hash.';
COMMENT ON COLUMN sumob_exports.trip_external_id IS
  'ID da viagem na planilha de apuração — é ele que nomeia o arquivo (alínea k).';
COMMENT ON COLUMN sumob_exports.content_sha256 IS
  'Hash do conteúdo exato entregue, evidência de que o arquivo não foi alterado à mão.';
COMMENT ON COLUMN sumob_exports.decendio IS
  'Decêndio do período (alínea h): 1 = dias 1-10, 2 = 11-20, 3 = 21 ao fim do mês.';

-- Campo que representa o "número de ordem do veículo" na Track7.
-- Varia entre operadoras, então é configurável por empresa.
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS vehicle_order_field text NOT NULL DEFAULT 'fleet_number';

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_vehicle_order_field_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_vehicle_order_field_check
  CHECK (vehicle_order_field IN ('fleet_number', 'description', 'registration_number'));

COMMENT ON COLUMN operators.vehicle_order_field IS
  'De qual campo da Track7 sai o número de ordem exigido pelo órgão gestor.';
