-- ============================================================
-- Alinhamento com o contrato oficial da API (Swagger MiX.Integrate v1)
--   · Position.Source é string ("GPS"), não numérico
--   · Event não traz Description: a descrição legível vem da
--     biblioteca de tipos de evento da organização
-- ============================================================

ALTER TABLE positions
  ALTER COLUMN source TYPE text USING source::text;

CREATE TABLE IF NOT EXISTS t7_event_types (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type_id   bigint NOT NULL,
  description     text,
  event_type      text,
  display_units   text,
  format_type     text,
  value_name      text,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_type_id)
);

COMMENT ON TABLE t7_event_types IS
  'Biblioteca de tipos de evento (api/libraryevents/organisation/{id}) — dá nome legível aos eventos de telemetria.';
