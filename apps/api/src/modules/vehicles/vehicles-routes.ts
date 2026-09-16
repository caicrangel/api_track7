import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';
import { notFound } from '../../lib/errors.js';
import { toCsv } from '../../lib/csv.js';

const SORTABLE: Record<string, string> = {
  description: 'v.description',
  registration: 'v.registration_number',
  fleet: 'v.fleet_number',
  odometer: 'v.odometer_km',
  lastContact: 'p.recorded_at',
  site: 'g.name',
  make: 'v.make',
};

const listSchema = z.object({
  /** Vazio = visão consolidada de todas as operadoras da conta. */
  operatorId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  siteId: z.coerce.number().optional(),
  fuelType: z.string().optional(),
  make: z.string().optional(),
  connectivity: z.enum(['MOVENDO', 'PARADO', 'SEM_COMUNICACAO']).optional(),
  sort: z.string().default('description'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  offlineHours: z.coerce.number().int().min(1).max(720).default(24),
});

type ListQuery = z.infer<typeof listSchema>;

function buildWhere(orgId: string, q: ListQuery) {
  // $2 é sempre a janela de "sem comunicação"; o predicado no-op abaixo garante
  // que ele seja referenciado mesmo nas consultas que não usam CONNECTIVITY_SQL.
  const params: unknown[] = [orgId, q.offlineHours, q.operatorId ?? null];
  const where = [
    'v.organization_id = $1',
    '($2::text IS NOT NULL)',
    '($3::uuid IS NULL OR v.operator_id = $3::uuid)',
  ];

  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(
      `(v.description ILIKE $${params.length} OR v.registration_number ILIKE $${params.length}
        OR v.fleet_number ILIKE $${params.length} OR v.vin_number ILIKE $${params.length}
        OR CAST(v.asset_id AS text) ILIKE $${params.length})`,
    );
  }
  if (q.status) {
    params.push(q.status);
    where.push(`v.status = $${params.length}`);
  }
  if (q.siteId) {
    params.push(q.siteId);
    where.push(`v.site_id = $${params.length}`);
  }
  if (q.fuelType) {
    params.push(q.fuelType);
    where.push(`v.fuel_type = $${params.length}`);
  }
  if (q.make) {
    params.push(q.make);
    where.push(`v.make = $${params.length}`);
  }
  if (q.connectivity) {
    params.push(q.connectivity);
    where.push(`${CONNECTIVITY_SQL} = $${params.length}`);
  }
  return { params, where: where.join(' AND ') };
}

/** Classificação operacional derivada da última posição conhecida. */
const CONNECTIVITY_SQL = `
  CASE
    WHEN p.recorded_at IS NULL OR p.recorded_at < now() - ($2 || ' hours')::interval THEN 'SEM_COMUNICACAO'
    WHEN coalesce(p.speed_kmh, 0) > 3 THEN 'MOVENDO'
    ELSE 'PARADO'
  END`;

const BASE_SELECT = `
  SELECT v.asset_id,
         v.description,
         v.registration_number,
         v.fleet_number,
         v.make,
         v.model,
         v.year,
         v.fuel_type,
         v.vin_number,
         v.status,
         v.odometer_km,
         v.engine_hours_seconds,
         v.operator_id,
         op.name       AS operator_name,
         v.site_id,
         g.name        AS site_name,
         v.default_driver_id,
         d.name        AS default_driver_name,
         v.icon,
         v.icon_colour,
         v.synced_at,
         p.recorded_at AS last_contact_at,
         p.latitude,
         p.longitude,
         p.speed_kmh,
         p.heading,
         p.formatted_address,
         ${CONNECTIVITY_SQL} AS connectivity
    FROM vehicles v
    LEFT JOIN vehicle_last_position p
           ON p.operator_id = v.operator_id AND p.asset_id = v.asset_id
    LEFT JOIN t7_groups g
           ON g.operator_id = v.operator_id AND g.group_id = v.site_id
    LEFT JOIN drivers d
           ON d.operator_id = v.operator_id AND d.driver_id = v.default_driver_id
    LEFT JOIN operators op
           ON op.id = v.operator_id`;

export async function vehiclesRoutes(app: FastifyInstance): Promise<void> {
  /** Listagem paginada com filtros. */
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const q = listSchema.parse(request.query);
    const { params, where } = buildWhere(me.orgId, q);

    const totalRow = await one<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM vehicles v
         LEFT JOIN vehicle_last_position p
                ON p.operator_id = v.operator_id AND p.asset_id = v.asset_id
        WHERE ${where}`,
      params,
    );

    const sortColumn = SORTABLE[q.sort] ?? SORTABLE.description;
    const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];

    const data = await rows(
      `${BASE_SELECT}
        WHERE ${where}
        ORDER BY ${sortColumn} ${q.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, v.asset_id
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );

    return { data, page: q.page, pageSize: q.pageSize, total: totalRow?.count ?? 0 };
  });

  /** Indicadores da frota para os cards do módulo. */
  app.get('/summary', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { offlineHours, operatorId } = z
      .object({
        offlineHours: z.coerce.number().int().min(1).max(720).default(24),
        operatorId: z.string().uuid().optional(),
      })
      .parse(request.query);

    const summary = await one(
      `SELECT
         count(*)::int                                                    AS total,
         count(*) FILTER (WHERE v.status = 'ACTIVE')::int                 AS ativos,
         count(*) FILTER (WHERE v.status = 'INACTIVE')::int               AS inativos,
         count(*) FILTER (WHERE coalesce(p.speed_kmh,0) > 3
                            AND p.recorded_at >= now() - ($2 || ' hours')::interval)::int AS movendo,
         count(*) FILTER (WHERE coalesce(p.speed_kmh,0) <= 3
                            AND p.recorded_at >= now() - ($2 || ' hours')::interval)::int AS parados,
         count(*) FILTER (WHERE p.recorded_at IS NULL
                             OR p.recorded_at < now() - ($2 || ' hours')::interval)::int  AS sem_comunicacao,
         coalesce(sum(v.odometer_km), 0)::numeric                         AS odometro_total,
         max(p.recorded_at)                                               AS ultima_transmissao
       FROM vehicles v
       LEFT JOIN vehicle_last_position p
              ON p.operator_id = v.operator_id AND p.asset_id = v.asset_id
      WHERE v.organization_id = $1 AND ($3::uuid IS NULL OR v.operator_id = $3::uuid)`,
      [me.orgId, offlineHours, operatorId ?? null],
    );

    const byType = await rows(
      `SELECT coalesce(nullif(v.make, ''), 'Não informado') AS label, count(*)::int AS total
         FROM vehicles v
        WHERE v.organization_id = $1 AND ($2::uuid IS NULL OR v.operator_id = $2::uuid)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [me.orgId, operatorId ?? null],
    );

    const bySite = await rows(
      `SELECT coalesce(g.name, 'Sem grupo') AS label, count(*)::int AS total
         FROM vehicles v
         LEFT JOIN t7_groups g ON g.operator_id = v.operator_id AND g.group_id = v.site_id
        WHERE v.organization_id = $1 AND ($2::uuid IS NULL OR v.operator_id = $2::uuid)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [me.orgId, operatorId ?? null],
    );

    return { summary, byType, bySite };
  });

  /** Opções para os filtros da tela. */
  app.get('/filters', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = z.object({ operatorId: z.string().uuid().optional() }).parse(request.query);
    const scope = [me.orgId, operatorId ?? null];
    const [makes, fuelTypes, sites] = await Promise.all([
      rows(
        `SELECT DISTINCT make AS value FROM vehicles
          WHERE organization_id = $1 AND ($2::uuid IS NULL OR operator_id = $2::uuid)
            AND make IS NOT NULL AND make <> '' ORDER BY 1`,
        scope,
      ),
      rows(
        `SELECT DISTINCT fuel_type AS value FROM vehicles
          WHERE organization_id = $1 AND ($2::uuid IS NULL OR operator_id = $2::uuid)
            AND fuel_type IS NOT NULL AND fuel_type <> '' ORDER BY 1`,
        scope,
      ),
      rows(
        `SELECT g.group_id AS value, g.name AS label, count(v.asset_id)::int AS total
           FROM t7_groups g
           LEFT JOIN vehicles v ON v.operator_id = g.operator_id AND v.site_id = g.group_id
          WHERE g.organization_id = $1 AND ($2::uuid IS NULL OR g.operator_id = $2::uuid)
          GROUP BY g.group_id, g.name
         HAVING count(v.asset_id) > 0
          ORDER BY g.name`,
        scope,
      ),
    ]);
    return { makes: makes.map((m) => m.value), fuelTypes: fuelTypes.map((f) => f.value), sites };
  });

  /** Exportação CSV respeitando os filtros aplicados. */
  app.get('/export', { preHandler: authenticate }, async (request, reply) => {
    const me = currentUser(request);
    const q = listSchema.parse({ ...(request.query as object), pageSize: 500, page: 1 });
    const { params, where } = buildWhere(me.orgId, q);

    const data = await rows(
      `${BASE_SELECT} WHERE ${where} ORDER BY v.description NULLS LAST LIMIT 50000`,
      params,
    );

    const csv = toCsv(data, [
      { key: 'operator_name', label: 'Empresa operadora' },
      { key: 'asset_id', label: 'ID Track7' },
      { key: 'description', label: 'Veículo' },
      { key: 'registration_number', label: 'Placa' },
      { key: 'fleet_number', label: 'Nº de frota' },
      { key: 'make', label: 'Marca' },
      { key: 'model', label: 'Modelo' },
      { key: 'year', label: 'Ano' },
      { key: 'fuel_type', label: 'Combustível' },
      { key: 'site_name', label: 'Grupo/Site' },
      { key: 'default_driver_name', label: 'Motorista padrão' },
      { key: 'odometer_km', label: 'Odômetro (km)' },
      { key: 'connectivity', label: 'Situação' },
      { key: 'last_contact_at', label: 'Última transmissão' },
      { key: 'formatted_address', label: 'Última localização' },
      { key: 'status', label: 'Status cadastral' },
    ]);

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="veiculos-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  /** Detalhe de um veículo. */
  app.get('/:assetId', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { assetId } = z.object({ assetId: z.coerce.number() }).parse(request.params);

    const { operatorId } = z.object({ operatorId: z.string().uuid().optional() }).parse(request.query);
    const vehicle = await one<{ operator_id: string }>(
      `${BASE_SELECT}
        WHERE v.organization_id = $1 AND ($3::uuid IS NULL OR v.operator_id = $3::uuid) AND v.asset_id = $4`,
      [me.orgId, 24, operatorId ?? null, assetId],
    );
    if (!vehicle) throw notFound('Veículo não encontrado.');

    const [trips, events, stats] = await Promise.all([
      rows(
        `SELECT trip_id, driver_id, trip_start, trip_end, distance_km, duration_seconds,
                driving_seconds, standing_seconds, max_speed_kmh, start_address, end_address
           FROM trips WHERE operator_id = $1 AND asset_id = $2
          ORDER BY trip_start DESC LIMIT 15`,
        [vehicle.operator_id, assetId],
      ),
      rows(
        `SELECT event_id, event_category, event_description, start_at, end_at, value, value_units,
                speed_limit, total_seconds, start_address
           FROM telemetry_events WHERE operator_id = $1 AND asset_id = $2
          ORDER BY start_at DESC LIMIT 15`,
        [vehicle.operator_id, assetId],
      ),
      one(
        `SELECT
           count(*)::int                                   AS viagens_30d,
           coalesce(sum(distance_km), 0)::numeric          AS km_30d,
           coalesce(sum(driving_seconds), 0)::int          AS conducao_30d_seg,
           coalesce(max(max_speed_kmh), 0)::numeric        AS velocidade_maxima_30d
         FROM trips
        WHERE operator_id = $1 AND asset_id = $2 AND trip_start >= now() - interval '30 days'`,
        [vehicle.operator_id, assetId],
      ),
    ]);

    return { vehicle, trips, events, stats };
  });

  /** Histórico de posições de um veículo. */
  app.get('/:assetId/positions', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { assetId } = z.object({ assetId: z.coerce.number() }).parse(request.params);
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(1000),
      })
      .parse(request.query);

    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 24 * 3600_000);

    const owner = await one<{ operator_id: string }>(
      `SELECT operator_id FROM vehicles WHERE organization_id = $1 AND asset_id = $2 LIMIT 1`,
      [me.orgId, assetId],
    );
    if (!owner) throw notFound('Veículo não encontrado.');

    const data = await rows(
      `SELECT position_id, recorded_at, latitude, longitude, speed_kmh, heading,
              odometer_km, formatted_address
         FROM positions
        WHERE operator_id = $1 AND asset_id = $2 AND recorded_at BETWEEN $3 AND $4
        ORDER BY recorded_at DESC
        LIMIT $5`,
      [owner.operator_id, assetId, from, to, q.limit],
    );
    return { data, from, to };
  });
}
