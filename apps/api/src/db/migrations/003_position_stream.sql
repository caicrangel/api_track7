-- ============================================================
-- Coletor contínuo de posições (fluxo "createdsince")
--
-- A API entrega as posições novas a partir de um ponteiro (sinceToken).
-- O ponteiro precisa sobreviver a reinícios, senão o histórico tem buracos.
-- Regra da API: o token não pode ter mais de 7 dias.
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_cursors (
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'track7',
  stream            text NOT NULL DEFAULT 'positions',
  since_token       text,
  token_updated_at  timestamptz,
  last_run_at       timestamptz,
  last_count        integer NOT NULL DEFAULT 0,
  total_collected   bigint NOT NULL DEFAULT 0,
  consecutive_errors integer NOT NULL DEFAULT 0,
  last_error        text,
  last_gap_from     timestamptz,
  last_gap_to       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider, stream)
);

COMMENT ON COLUMN stream_cursors.since_token IS
  'Ponteiro devolvido pela API no cabeçalho GetSinceToken (formato yyyyMMddHHmmssfff, UTC).';
COMMENT ON COLUMN stream_cursors.last_gap_from IS
  'Início de uma lacuna detectada (coletor parado por mais de 7 dias) — exige backfill por período.';

-- Configuração do coletor por organização
ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS stream_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stream_interval_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS stream_quantity integer NOT NULL DEFAULT 1000;

COMMENT ON COLUMN integration_credentials.stream_interval_seconds IS
  'Intervalo entre ciclos do coletor. 30s é o valor usado pelo exemplo oficial da plataforma.';
