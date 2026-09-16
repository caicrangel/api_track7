import { one, pool, query, transaction } from '../../db/pool.js';
import { bulkUpsert, chunk } from '../../lib/bulk.js';
import { acquireLock, cacheDelPrefix } from '../../lib/cache.js';
import { badRequest } from '../../lib/errors.js';
import { buildClient, markSyncResult } from './credentials.js';
import type {
  Track7Asset,
  Track7Driver,
  Track7Event,
  Track7Group,
  Track7LibraryEvent,
  Track7Position,
  Track7Trip,
} from './track7-client.js';
import { splitWindows, timeSpanToSeconds, Track7Client } from './track7-client.js';

export type SyncKind = 'catalog' | 'incremental' | 'history';

export interface SyncOptions {
  organizationId: string;
  /** Empresa operadora dona das credenciais e dos dados. */
  operatorId: string;
  kind?: SyncKind;
  triggerSource?: 'manual' | 'schedule' | 'boot' | 'api';
  userId?: string | null;
  from?: Date;
  to?: Date;
}

export interface SyncStep {
  step: string;
  status: 'ok' | 'error' | 'skipped';
  count?: number;
  durationMs: number;
  error?: string;
}

export interface SyncResult {
  runId: string;
  status: 'SUCCESS' | 'ERROR' | 'PARTIAL';
  stats: Record<string, number>;
  steps: SyncStep[];
  error?: string;
  durationMs: number;
}

/** A API devolve datas sem fuso; são UTC. */
function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flattenGroups(
  node: Track7Group,
  parentId: number | null,
  level: number,
  acc: Array<{ node: Track7Group; parentId: number | null; level: number }> = [],
) {
  acc.push({ node, parentId, level });
  for (const child of node.SubGroups ?? []) flattenGroups(child, node.GroupId, level + 1, acc);
  return acc;
}

export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const { organizationId, operatorId, kind = 'incremental', triggerSource = 'manual', userId = null } = options;

  const release = await acquireLock(`sync:${operatorId}`, 1800);
  if (!release) {
    throw badRequest('Já existe uma sincronização em andamento para esta empresa operadora.');
  }

  const startedAt = Date.now();
  const steps: SyncStep[] = [];
  const stats: Record<string, number> = {};

  const run = await one<{ id: string }>(
    `INSERT INTO sync_runs (organization_id, operator_id, provider, kind, status, trigger_source, created_by)
     VALUES ($1,$2,'track7',$3,'RUNNING',$4,$5) RETURNING id`,
    [organizationId, operatorId, kind, triggerSource, userId],
  );
  const runId = run!.id;

  const track = async <T>(name: string, fn: () => Promise<T>, countable = true): Promise<T | null> => {
    const t0 = Date.now();
    try {
      const result = await fn();
      const count = !countable
        ? undefined
        : Array.isArray(result)
          ? result.length
          : typeof result === 'number'
            ? result
            : undefined;
      steps.push({ step: name, status: 'ok', count, durationMs: Date.now() - t0 });
      if (typeof count === 'number') stats[name] = count;
      return result;
    } catch (err) {
      steps.push({
        step: name,
        status: 'error',
        durationMs: Date.now() - t0,
        error: (err as Error).message,
      });
      throw err;
    }
  };

  let status: SyncResult['status'] = 'SUCCESS';
  let fatalError: string | undefined;

  try {
    const { row, client } = await buildClient(operatorId);

    // 1) Organizações visíveis / grupo raiz
    const organisationId = await track('organizacao', async () => {
      const orgs = await client.getOrganisationGroups();
      if (!orgs.length) throw badRequest('Nenhuma organização disponível para estas credenciais na Track7.');
      const configured = row.organisation_id;
      const chosen = configured ? orgs.find((o) => Number(o.GroupId) === Number(configured)) : orgs[0];
      const resolved = chosen ?? orgs[0];
      if (!configured) {
        await query(
          `UPDATE integration_credentials SET organisation_id = $2, updated_at = now()
            WHERE operator_id = $1 AND provider = 'track7'`,
          [operatorId, resolved.GroupId],
        );
      }
      await upsertGroups(organizationId, operatorId, orgs.map((o) => ({ node: o, parentId: null, level: 0 })), true);
      return Number(resolved.GroupId);
    }, false);

    if (!organisationId) throw badRequest('Não foi possível determinar a organização na Track7.');

    // 2) Hierarquia de grupos e sites
    await track('grupos', async () => {
      const tree = await client.getSubGroups(organisationId);
      const flat = flattenGroups(tree, null, 0);
      await upsertGroups(organizationId, operatorId, flat, false);
      return flat.length;
    });

    // Grupos a consultar: os configurados ou a organização inteira
    const targetGroups = row.group_ids?.length ? row.group_ids.map(Number) : [organisationId];

    // 3) Veículos
    const assetIds = await track('veiculos', async () => {
      const seen = new Map<number, Track7Asset>();
      for (const groupId of targetGroups) {
        const assets = await client.getAssets(groupId);
        for (const asset of assets) seen.set(Number(asset.AssetId), { ...asset, __groupId: groupId });
      }
      const list = [...seen.values()];
      await upsertVehicles(organizationId, operatorId, list);
      stats.veiculos = list.length;
      return list.map((a) => Number(a.AssetId));
    });

    // 4) Motoristas
    await track('motoristas', async () => {
      const drivers = await client.getDrivers(organisationId);
      await upsertDrivers(organizationId, operatorId, drivers);
      return drivers.length;
    });

    // 5) Últimas posições
    await track('posicoes_atuais', async () => {
      const positions = await client.getLatestPositionsByGroups(targetGroups, 1);
      await upsertPositions(organizationId, operatorId, positions, true);
      return positions.length;
    });

    // 6) Biblioteca de tipos de evento (dá nome legível aos eventos)
    const eventTypes = await track('tipos_evento', async () => {
      const library = await client.getLibraryEvents(organisationId);
      await upsertEventTypes(organizationId, operatorId, library);
      return library;
    });
    const eventTypeNames = new Map<number, string>();
    for (const item of eventTypes ?? []) {
      if (item.EventTypeId != null && item.Description) {
        eventTypeNames.set(Number(item.EventTypeId), item.Description);
      }
    }

    // 7) Histórico (viagens e eventos)
    if (kind !== 'catalog' && assetIds && assetIds.length) {
      const to = options.to ?? new Date();
      const from =
        options.from ??
        (kind === 'history'
          ? new Date(to.getTime() - row.history_days * 86400_000)
          : new Date(
              Math.max(
                (row.last_sync_at ? new Date(row.last_sync_at).getTime() : 0) || 0,
                to.getTime() - row.history_days * 86400_000,
              ),
            ));

      await track('viagens', () => syncTrips(organizationId, operatorId, client, assetIds, from, to));
      await track('eventos', () => syncEvents(organizationId, operatorId, client, assetIds, from, to, eventTypeNames));
    } else {
      steps.push({ step: 'viagens', status: 'skipped', durationMs: 0 });
      steps.push({ step: 'eventos', status: 'skipped', durationMs: 0 });
    }

    await markSyncResult(operatorId, 'SUCCESS', null);
  } catch (err) {
    status = steps.some((s) => s.status === 'ok') ? 'PARTIAL' : 'ERROR';
    fatalError = (err as Error).message;
    await markSyncResult(operatorId, status, fatalError).catch(() => {});
  } finally {
    await release();
  }

  const durationMs = Date.now() - startedAt;
  await query(
    `UPDATE sync_runs
        SET status = $2, finished_at = now(), duration_ms = $3, stats = $4::jsonb, steps = $5::jsonb, error = $6
      WHERE id = $1`,
    [runId, status, durationMs, JSON.stringify(stats), JSON.stringify(steps), fatalError ?? null],
  );
  await cacheDelPrefix(`org:${organizationId}:`);
  await cacheDelPrefix(`op:${operatorId}:`);

  return { runId, status, stats, steps, error: fatalError, durationMs };
}

// ─── Persistência ────────────────────────────────────────────

async function upsertGroups(
  organizationId: string,
  operatorId: string,
  entries: Array<{ node: Track7Group; parentId: number | null; level: number }>,
  isOrganisation: boolean,
): Promise<number> {
  if (!entries.length) return 0;
  const values = entries.map(({ node, parentId, level }) => [
    organizationId,
    operatorId,
    Number(node.GroupId),
    parentId,
    node.Name ?? `Grupo ${node.GroupId}`,
    typeof node.Type === 'number' ? node.Type : null,
    typeof node.Type === 'string' ? node.Type : null,
    node.DisplayTimeZone ?? null,
    level,
    isOrganisation,
    JSON.stringify({ ...node, SubGroups: undefined }),
  ]);

  return transaction((client) =>
    bulkUpsert(
      client,
      't7_groups',
      [
        'organization_id',
        'operator_id',
        'group_id',
        'parent_group_id',
        'name',
        'group_type',
        'group_type_name',
        'time_zone',
        'level',
        'is_organisation',
        'raw',
      ],
      values,
      ['operator_id', 'group_id'],
      ['parent_group_id', 'name', 'group_type', 'group_type_name', 'time_zone', 'level', 'raw'],
    ),
  );
}

async function upsertVehicles(
  organizationId: string,
  operatorId: string,
  assets: Track7Asset[],
): Promise<number> {
  if (!assets.length) return 0;
  const values = assets.map((a) => [
    organizationId,
    operatorId,
    Number(a.AssetId),
    num(a.SiteId),
    num((a as Record<string, unknown>).__groupId),
    a.Description ?? null,
    a.RegistrationNumber ?? null,
    a.FleetNumber ?? null,
    num(a.AssetTypeId),
    a.Make ?? null,
    a.Model ?? null,
    a.Year ?? null,
    a.VinNumber ?? null,
    a.EngineNumber ?? null,
    a.SerialNumber ?? null,
    a.Colour ?? null,
    a.FuelType ?? null,
    num(a.FuelTankCapacity),
    num(a.TargetFuelConsumption),
    num(a.Odometer),
    timeSpanToSeconds(a.EngineHours),
    num(a.DefaultDriverId),
    a.Country ?? null,
    a.Icon ?? null,
    a.IconColour ?? null,
    a.Notes ?? null,
    Boolean(a.IsConnectedTrailer),
    a.CreatedBy ?? null,
    parseDate(a.CreatedDate),
    JSON.stringify(a),
  ]);

  return transaction(async (client) => {
    const affected = await bulkUpsert(
      client,
      'vehicles',
      [
        'organization_id',
        'operator_id',
        'asset_id',
        'site_id',
        'group_id',
        'description',
        'registration_number',
        'fleet_number',
        'asset_type_id',
        'make',
        'model',
        'year',
        'vin_number',
        'engine_number',
        'serial_number',
        'colour',
        'fuel_type',
        'fuel_tank_capacity',
        'target_fuel_consumption',
        'odometer_km',
        'engine_hours_seconds',
        'default_driver_id',
        'country',
        'icon',
        'icon_colour',
        'notes',
        'is_connected_trailer',
        'created_by',
        'created_date',
        'raw',
      ],
      values,
      ['operator_id', 'asset_id'],
      [
        'site_id',
        'group_id',
        'description',
        'registration_number',
        'fleet_number',
        'asset_type_id',
        'make',
        'model',
        'year',
        'vin_number',
        'engine_number',
        'serial_number',
        'colour',
        'fuel_type',
        'fuel_tank_capacity',
        'target_fuel_consumption',
        'odometer_km',
        'engine_hours_seconds',
        'default_driver_id',
        'country',
        'icon',
        'icon_colour',
        'notes',
        'is_connected_trailer',
        'created_by',
        'created_date',
        'raw',
      ],
    );
    // marca como INACTIVE o que não veio mais da Track7
    await client.query(
      `UPDATE vehicles SET status = CASE WHEN asset_id = ANY($2::bigint[]) THEN 'ACTIVE' ELSE 'INACTIVE' END,
              synced_at = now()
        WHERE operator_id = $1`,
      [operatorId, assets.map((a) => Number(a.AssetId))],
    );
    return affected;
  });
}

async function upsertDrivers(
  organizationId: string,
  operatorId: string,
  drivers: Track7Driver[],
): Promise<number> {
  if (!drivers.length) return 0;
  const values = drivers.map((d) => [
    organizationId,
    operatorId,
    Number(d.DriverId),
    num(d.SiteId),
    d.Name ?? null,
    d.EmployeeNumber ?? null,
    d.MobileNumber ?? null,
    d.Email ?? null,
    d.ExtendedDriverId ?? null,
    d.Country ?? null,
    Boolean(d.IsSystemDriver),
    JSON.stringify(d),
  ]);

  return transaction((client) =>
    bulkUpsert(
      client,
      'drivers',
      [
        'organization_id',
        'operator_id',
        'driver_id',
        'site_id',
        'name',
        'employee_number',
        'mobile_number',
        'email',
        'extended_driver_id',
        'country',
        'is_system_driver',
        'raw',
      ],
      values,
      ['operator_id', 'driver_id'],
      [
        'site_id',
        'name',
        'employee_number',
        'mobile_number',
        'email',
        'extended_driver_id',
        'country',
        'is_system_driver',
        'raw',
      ],
    ),
  );
}

export async function upsertPositions(
  organizationId: string,
  operatorId: string,
  positions: Track7Position[],
  updateLast: boolean,
): Promise<number> {
  const valid = positions.filter((p) => parseDate(p.Timestamp));
  if (!valid.length) return 0;

  const values = valid.map((p) => [
    organizationId,
    operatorId,
    Number(p.PositionId),
    Number(p.AssetId),
    num(p.DriverId),
    parseDate(p.Timestamp),
    num(p.Latitude),
    num(p.Longitude),
    num(p.SpeedKilometresPerHour),
    num(p.SpeedLimit),
    num(p.AltitudeMetres),
    num(p.Heading),
    num(p.OdometerKilometres),
    p.FormattedAddress ?? null,
    p.Source ?? null,
  ]);

  return transaction(async (client) => {
    const affected = await bulkUpsert(
      client,
      'positions',
      [
        'organization_id',
        'operator_id',
        'position_id',
        'asset_id',
        'driver_id',
        'recorded_at',
        'latitude',
        'longitude',
        'speed_kmh',
        'speed_limit',
        'altitude_m',
        'heading',
        'odometer_km',
        'formatted_address',
        'source',
      ],
      values,
      ['operator_id', 'recorded_at', 'position_id'],
      [],
    );

    if (updateLast) {
      // mantém apenas a posição mais recente de cada veículo
      const latest = new Map<number, Track7Position>();
      for (const p of valid) {
        const current = latest.get(Number(p.AssetId));
        if (!current || parseDate(p.Timestamp)! > parseDate(current.Timestamp)!) {
          latest.set(Number(p.AssetId), p);
        }
      }
      const lastValues = [...latest.values()].map((p) => [
        organizationId,
        operatorId,
        Number(p.AssetId),
        Number(p.PositionId),
        num(p.DriverId),
        parseDate(p.Timestamp),
        num(p.Latitude),
        num(p.Longitude),
        num(p.SpeedKilometresPerHour),
        num(p.Heading),
        num(p.OdometerKilometres),
        p.FormattedAddress ?? null,
      ]);
      await bulkUpsert(
        client,
        'vehicle_last_position',
        [
          'organization_id',
          'operator_id',
          'asset_id',
          'position_id',
          'driver_id',
          'recorded_at',
          'latitude',
          'longitude',
          'speed_kmh',
          'heading',
          'odometer_km',
          'formatted_address',
        ],
        lastValues,
        ['operator_id', 'asset_id'],
        [
          'position_id',
          'driver_id',
          'recorded_at',
          'latitude',
          'longitude',
          'speed_kmh',
          'heading',
          'odometer_km',
          'formatted_address',
        ],
      );
    }
    return affected;
  });
}

async function syncTrips(
  organizationId: string,
  operatorId: string,
  client: Track7Client,
  assetIds: number[],
  from: Date,
  to: Date,
): Promise<number> {
  let total = 0;
  // a API limita cada consulta a 7 dias
  for (const [windowStart, windowEnd] of splitWindows(from, to)) {
    for (const batch of chunk(assetIds, 50)) {
      const trips = await client.getTripsByAssets(batch, windowStart, windowEnd);
      total += await upsertTrips(organizationId, operatorId, trips);
    }
  }
  return total;
}

async function upsertTrips(
  organizationId: string,
  operatorId: string,
  trips: Track7Trip[],
): Promise<number> {
  const valid = trips.filter((t) => parseDate(t.TripStart));
  if (!valid.length) return 0;

  const values = valid.map((t) => [
    organizationId,
    operatorId,
    Number(t.TripId),
    Number(t.AssetId),
    num(t.DriverId),
    parseDate(t.TripStart),
    parseDate(t.TripEnd),
    parseDate(t.FirstDepart),
    parseDate(t.LastHalt),
    num(t.DrivingTime),
    num(t.StandingTime),
    num(t.Duration),
    num(t.DistanceKilometers),
    num(t.StartOdometerKilometers),
    num(t.EndOdometerKilometers),
    num(t.MaxSpeedKilometersPerHour),
    num(t.MaxAccelerationKilometersPerHourPerSecond),
    num(t.MaxDecelerationKilometersPerHourPerSecond),
    num(t.MaxRpm),
    num(t.FuelUsedLitres),
    num(t.StartPosition?.Latitude),
    num(t.StartPosition?.Longitude),
    t.StartPosition?.FormattedAddress ?? null,
    num(t.EndPosition?.Latitude),
    num(t.EndPosition?.Longitude),
    t.EndPosition?.FormattedAddress ?? null,
    t.Classification?.Classification ?? null,
    JSON.stringify({ ...t, SubTrips: undefined }),
  ]);

  const columns = [
    'organization_id',
    'operator_id',
    'trip_id',
    'asset_id',
    'driver_id',
    'trip_start',
    'trip_end',
    'first_depart',
    'last_halt',
    'driving_seconds',
    'standing_seconds',
    'duration_seconds',
    'distance_km',
    'start_odometer_km',
    'end_odometer_km',
    'max_speed_kmh',
    'max_acceleration',
    'max_deceleration',
    'max_rpm',
    'fuel_used_litres',
    'start_latitude',
    'start_longitude',
    'start_address',
    'end_latitude',
    'end_longitude',
    'end_address',
    'classification',
    'raw',
  ];

  return transaction((client) =>
    bulkUpsert(client, 'trips', columns, values, ['operator_id', 'trip_id'], columns.slice(3)),
  );
}

async function syncEvents(
  organizationId: string,
  operatorId: string,
  client: Track7Client,
  assetIds: number[],
  from: Date,
  to: Date,
  eventTypeNames: Map<number, string>,
): Promise<number> {
  let total = 0;
  // a API limita cada consulta a 7 dias
  for (const [windowStart, windowEnd] of splitWindows(from, to)) {
    for (const batch of chunk(assetIds, 50)) {
      const events = await client.getEventsByAssets(batch, windowStart, windowEnd);
      total += await upsertEvents(organizationId, operatorId, events, eventTypeNames);
    }
  }
  return total;
}

async function upsertEventTypes(
  organizationId: string,
  operatorId: string,
  library: Track7LibraryEvent[],
): Promise<number> {
  if (!library.length) return 0;
  const values = library.map((item) => [
    organizationId,
    operatorId,
    Number(item.EventTypeId),
    item.Description ?? null,
    item.EventType ?? null,
    item.DisplayUnits ?? null,
    item.FormatType ?? null,
    item.ValueName ?? null,
    JSON.stringify(item),
  ]);
  const columns = [
    'organization_id',
    'operator_id',
    'event_type_id',
    'description',
    'event_type',
    'display_units',
    'format_type',
    'value_name',
    'raw',
  ];
  return transaction((client) =>
    bulkUpsert(client, 't7_event_types', columns, values, ['operator_id', 'event_type_id'], columns.slice(3)),
  );
}

async function upsertEvents(
  organizationId: string,
  operatorId: string,
  events: Track7Event[],
  eventTypeNames: Map<number, string> = new Map(),
): Promise<number> {
  const valid = events.filter((e) => parseDate(e.StartDateTime));
  if (!valid.length) return 0;

  const values = valid.map((e) => [
    organizationId,
    operatorId,
    Number(e.EventId),
    Number(e.AssetId),
    num(e.DriverId),
    num(e.EventTypeId),
    e.EventCategory ?? null,
    // o contrato da API não traz descrição no evento: ela vem da biblioteca de tipos
    (e.EventTypeId != null ? eventTypeNames.get(Number(e.EventTypeId)) : undefined) ?? null,
    parseDate(e.StartDateTime),
    parseDate(e.EndDateTime),
    num(e.Value),
    e.ValueType ?? null,
    e.ValueUnits ?? null,
    num(e.SpeedLimit),
    num(e.TotalTimeSeconds),
    num(e.TotalOccurances),
    num(e.StartPosition?.Latitude),
    num(e.StartPosition?.Longitude),
    e.StartPosition?.FormattedAddress ?? null,
    num(e.StartOdometerKilometres),
    JSON.stringify(e),
  ]);

  const columns = [
    'organization_id',
    'operator_id',
    'event_id',
    'asset_id',
    'driver_id',
    'event_type_id',
    'event_category',
    'event_description',
    'start_at',
    'end_at',
    'value',
    'value_type',
    'value_units',
    'speed_limit',
    'total_seconds',
    'total_occurrences',
    'start_latitude',
    'start_longitude',
    'start_address',
    'start_odometer_km',
    'raw',
  ];

  return transaction((client) =>
    bulkUpsert(client, 'telemetry_events', columns, values, ['operator_id', 'event_id'], columns.slice(3)),
  );
}

export async function listSyncRuns(organizationId: string, limit = 20, operatorId?: string | null) {
  const result = await pool.query(
    `SELECT r.id, r.kind, r.status, r.trigger_source, r.started_at, r.finished_at,
            r.duration_ms, r.stats, r.steps, r.error,
            u.name AS created_by_name, op.name AS operator_name
       FROM sync_runs r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN operators op ON op.id = r.operator_id
      WHERE r.organization_id = $1
        AND ($3::uuid IS NULL OR r.operator_id = $3::uuid)
      ORDER BY r.started_at DESC
      LIMIT $2`,
    [organizationId, limit, operatorId ?? null],
  );
  return result.rows;
}
