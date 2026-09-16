-- ============================================================
-- FleetGov · schema base (multi-tenant)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─── Organizações (tenants) ────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  document      text,
  timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Usuários do sistema ───────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  email                text NOT NULL,
  password_hash        text NOT NULL,
  role                 text NOT NULL DEFAULT 'VIEWER'
                         CHECK (role IN ('ADMIN','MANAGER','OPERATOR','VIEWER')),
  status               text NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','INACTIVE')),
  phone                text,
  job_title            text,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts      integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_org_idx ON users (organization_id);

-- ─── Sessões / refresh tokens ──────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ─── Auditoria ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id              bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON audit_logs (organization_id, created_at DESC);

-- ─── Credenciais de integração (cifradas em repouso) ───────
CREATE TABLE IF NOT EXISTS integration_credentials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'track7',
  label              text NOT NULL DEFAULT 'Track7 (MiX Telematics)',
  region             text NOT NULL DEFAULT 'us',
  identity_url       text NOT NULL DEFAULT 'https://identity.us.mixtelematics.com/core',
  api_url            text NOT NULL DEFAULT 'https://integrate.us.mixtelematics.com',
  scope              text NOT NULL DEFAULT 'offline_access MiX.Integrate',
  client_id_enc      text,
  client_secret_enc  text,
  username_enc       text,
  password_enc       text,
  organisation_id    bigint,
  group_ids          bigint[] NOT NULL DEFAULT '{}',
  sync_enabled       boolean NOT NULL DEFAULT true,
  sync_cron          text NOT NULL DEFAULT '0 */6 * * *',
  history_days       integer NOT NULL DEFAULT 7,
  last_sync_at       timestamptz,
  last_sync_status   text,
  last_sync_error    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

-- ─── Histórico de sincronizações ───────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'track7',
  kind            text NOT NULL DEFAULT 'full',
  status          text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING','SUCCESS','ERROR','PARTIAL')),
  trigger_source  text NOT NULL DEFAULT 'manual',
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer,
  stats           jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  error           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sync_runs_org_started_idx ON sync_runs (organization_id, started_at DESC);

-- ─── Grupos / sites vindos da Track7 ───────────────────────
CREATE TABLE IF NOT EXISTS t7_groups (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id        bigint NOT NULL,
  parent_group_id bigint,
  name            text NOT NULL,
  group_type      integer,
  group_type_name text,
  time_zone       text,
  level           integer NOT NULL DEFAULT 0,
  is_organisation boolean NOT NULL DEFAULT false,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, group_id)
);
CREATE INDEX IF NOT EXISTS t7_groups_parent_idx ON t7_groups (organization_id, parent_group_id);

-- ─── Motoristas ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  driver_id           bigint NOT NULL,
  site_id             bigint,
  name                text,
  employee_number     text,
  mobile_number       text,
  email               text,
  extended_driver_id  text,
  country             text,
  is_system_driver    boolean NOT NULL DEFAULT false,
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  synced_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, driver_id)
);
CREATE INDEX IF NOT EXISTS drivers_name_trgm_idx ON drivers USING gin (name gin_trgm_ops);

-- ─── Veículos (assets) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id              bigint NOT NULL,
  site_id               bigint,
  group_id              bigint,
  description           text,
  registration_number   text,
  fleet_number          text,
  asset_type_id         integer,
  asset_type_name       text,
  make                  text,
  model                 text,
  year                  text,
  vin_number            text,
  engine_number         text,
  serial_number         text,
  colour                text,
  fuel_type             text,
  fuel_tank_capacity    numeric(10,2),
  target_fuel_consumption numeric(10,2),
  odometer_km           numeric(14,2),
  engine_hours_seconds  bigint,
  default_driver_id     bigint,
  country               text,
  icon                  text,
  icon_colour           text,
  notes                 text,
  is_connected_trailer  boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by            text,
  created_date          timestamptz,
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  synced_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, asset_id)
);
CREATE INDEX IF NOT EXISTS vehicles_org_desc_idx ON vehicles (organization_id, description);
CREATE INDEX IF NOT EXISTS vehicles_org_plate_idx ON vehicles (organization_id, registration_number);
CREATE INDEX IF NOT EXISTS vehicles_site_idx ON vehicles (organization_id, site_id);
CREATE INDEX IF NOT EXISTS vehicles_search_trgm_idx ON vehicles
  USING gin ((coalesce(description,'') || ' ' || coalesce(registration_number,'') || ' ' || coalesce(fleet_number,'')) gin_trgm_ops);

-- ─── Posições (particionada por mês) ───────────────────────
CREATE TABLE IF NOT EXISTS positions (
  organization_id  uuid NOT NULL,
  position_id      bigint NOT NULL,
  asset_id         bigint NOT NULL,
  driver_id        bigint,
  recorded_at      timestamptz NOT NULL,
  latitude         double precision,
  longitude        double precision,
  speed_kmh        real,
  speed_limit      real,
  altitude_m       integer,
  heading          integer,
  odometer_km      real,
  formatted_address text,
  source           smallint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, recorded_at, position_id)
) PARTITION BY RANGE (recorded_at);
CREATE INDEX IF NOT EXISTS positions_asset_time_idx ON positions (organization_id, asset_id, recorded_at DESC);

-- ─── Última posição conhecida por veículo ──────────────────
CREATE TABLE IF NOT EXISTS vehicle_last_position (
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id          bigint NOT NULL,
  position_id       bigint,
  driver_id         bigint,
  recorded_at       timestamptz,
  latitude          double precision,
  longitude         double precision,
  speed_kmh         real,
  heading           integer,
  odometer_km       real,
  formatted_address text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, asset_id)
);
CREATE INDEX IF NOT EXISTS vehicle_last_position_time_idx ON vehicle_last_position (organization_id, recorded_at DESC);

-- ─── Viagens ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id             bigint NOT NULL,
  asset_id            bigint NOT NULL,
  driver_id           bigint,
  trip_start          timestamptz NOT NULL,
  trip_end            timestamptz,
  first_depart        timestamptz,
  last_halt           timestamptz,
  driving_seconds     integer,
  standing_seconds    integer,
  duration_seconds    integer,
  distance_km         numeric(12,3),
  start_odometer_km   numeric(14,2),
  end_odometer_km     numeric(14,2),
  max_speed_kmh       numeric(8,2),
  max_acceleration    numeric(8,2),
  max_deceleration    numeric(8,2),
  max_rpm             numeric(10,2),
  fuel_used_litres    numeric(12,3),
  start_latitude      double precision,
  start_longitude     double precision,
  start_address       text,
  end_latitude        double precision,
  end_longitude       double precision,
  end_address         text,
  classification      text,
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, trip_id)
);
CREATE INDEX IF NOT EXISTS trips_asset_start_idx ON trips (organization_id, asset_id, trip_start DESC);
CREATE INDEX IF NOT EXISTS trips_start_brin ON trips USING brin (trip_start);
CREATE INDEX IF NOT EXISTS trips_driver_idx ON trips (organization_id, driver_id, trip_start DESC);

-- ─── Eventos de telemetria ─────────────────────────────────
CREATE TABLE IF NOT EXISTS telemetry_events (
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id          bigint NOT NULL,
  asset_id          bigint NOT NULL,
  driver_id         bigint,
  event_type_id     bigint,
  event_category    text,
  event_description text,
  start_at          timestamptz NOT NULL,
  end_at            timestamptz,
  value             double precision,
  value_type        text,
  value_units       text,
  speed_limit       real,
  total_seconds     integer,
  total_occurrences integer,
  start_latitude    double precision,
  start_longitude   double precision,
  start_address     text,
  start_odometer_km numeric(14,2),
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_id)
);
CREATE INDEX IF NOT EXISTS events_asset_start_idx ON telemetry_events (organization_id, asset_id, start_at DESC);
CREATE INDEX IF NOT EXISTS events_category_idx ON telemetry_events (organization_id, event_category, start_at DESC);
CREATE INDEX IF NOT EXISTS events_start_brin ON telemetry_events USING brin (start_at);

-- ─── Relatórios ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'GERAL',
  is_system       boolean NOT NULL DEFAULT false,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS report_definitions_code_uidx
  ON report_definitions (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE IF NOT EXISTS report_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_code     text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'SUCCESS',
  row_count       integer NOT NULL DEFAULT 0,
  duration_ms     integer,
  format          text NOT NULL DEFAULT 'json',
  error           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_executions_org_idx ON report_executions (organization_id, created_at DESC);

-- ─── Helper: cria partições mensais ────────────────────────
CREATE OR REPLACE FUNCTION ensure_month_partitions(p_table text, p_from date, p_months integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  i integer;
  start_d date;
  end_d date;
  part_name text;
BEGIN
  FOR i IN 0..(p_months - 1) LOOP
    start_d := (date_trunc('month', p_from::timestamp) + (i || ' month')::interval)::date;
    end_d := (start_d + interval '1 month')::date;
    part_name := format('%s_p%s', p_table, to_char(start_d, 'YYYYMM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                     part_name, p_table, start_d, end_d);
    END IF;
  END LOOP;
END;
$$;

-- Partições: mês anterior + 12 meses à frente
SELECT ensure_month_partitions('positions', (date_trunc('month', now()) - interval '1 month')::date, 14);
