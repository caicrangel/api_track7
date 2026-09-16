import type { FastifyInstance } from 'fastify';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const cacheKey = `org:${me.orgId}:dashboard`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const [frota, atividade, topKm, eventos, ultimaSync] = await Promise.all([
      one(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE v.status = 'ACTIVE')::int AS ativos,
                count(*) FILTER (WHERE coalesce(p.speed_kmh,0) > 3
                                   AND p.recorded_at >= now() - interval '24 hours')::int AS movendo,
                count(*) FILTER (WHERE p.recorded_at IS NULL
                                    OR p.recorded_at < now() - interval '24 hours')::int AS sem_comunicacao
           FROM vehicles v
           LEFT JOIN vehicle_last_position p
                  ON p.organization_id = v.organization_id AND p.asset_id = v.asset_id
          WHERE v.organization_id = $1`,
        [me.orgId],
      ),
      rows(
        `SELECT date_trunc('day', trip_start)::date AS dia,
                round(coalesce(sum(distance_km), 0), 1) AS km,
                count(*)::int AS viagens
           FROM trips
          WHERE organization_id = $1 AND trip_start >= now() - interval '14 days'
          GROUP BY 1 ORDER BY 1`,
        [me.orgId],
      ),
      rows(
        `SELECT v.description AS veiculo, v.registration_number AS placa,
                round(coalesce(sum(t.distance_km), 0), 1) AS km
           FROM trips t
           JOIN vehicles v ON v.organization_id = t.organization_id AND v.asset_id = t.asset_id
          WHERE t.organization_id = $1 AND t.trip_start >= now() - interval '30 days'
          GROUP BY 1, 2 ORDER BY km DESC LIMIT 8`,
        [me.orgId],
      ),
      rows(
        `SELECT coalesce(nullif(event_category, ''), 'Não classificado') AS categoria, count(*)::int AS total
           FROM telemetry_events
          WHERE organization_id = $1 AND start_at >= now() - interval '30 days'
          GROUP BY 1 ORDER BY total DESC LIMIT 6`,
        [me.orgId],
      ),
      one(
        `SELECT status, started_at, finished_at, duration_ms, stats
           FROM sync_runs WHERE organization_id = $1
          ORDER BY started_at DESC LIMIT 1`,
        [me.orgId],
      ),
    ]);

    const payload = { frota, atividade, topKm, eventos, ultimaSync };
    await cacheSet(cacheKey, payload, 60);
    return payload;
  });
}
