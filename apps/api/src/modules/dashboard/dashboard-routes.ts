import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, rows } from '../../db/pool.js';
import { authenticate, currentUser } from '../../lib/auth-guard.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const me = currentUser(request);
    const { operatorId } = z.object({ operatorId: z.string().uuid().optional() }).parse(request.query);
    const scope: unknown[] = [me.orgId, operatorId ?? null];
    const cacheKey = `org:${me.orgId}:dashboard:${operatorId ?? 'todas'}`;
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
                  ON p.operator_id = v.operator_id AND p.asset_id = v.asset_id
          WHERE v.organization_id = $1 AND ($2::uuid IS NULL OR v.operator_id = $2::uuid)`,
        scope,
      ),
      rows(
        `SELECT date_trunc('day', trip_start)::date AS dia,
                round(coalesce(sum(distance_km), 0), 1) AS km,
                count(*)::int AS viagens
           FROM trips
          WHERE organization_id = $1 AND ($2::uuid IS NULL OR operator_id = $2::uuid)
            AND trip_start >= now() - interval '14 days'
          GROUP BY 1 ORDER BY 1`,
        scope,
      ),
      rows(
        `SELECT v.description AS veiculo, v.registration_number AS placa,
                round(coalesce(sum(t.distance_km), 0), 1) AS km
           FROM trips t
           JOIN vehicles v ON v.operator_id = t.operator_id AND v.asset_id = t.asset_id
          WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.operator_id = $2::uuid)
            AND t.trip_start >= now() - interval '30 days'
          GROUP BY 1, 2 ORDER BY km DESC LIMIT 8`,
        scope,
      ),
      rows(
        `SELECT coalesce(nullif(event_category, ''), 'Não classificado') AS categoria, count(*)::int AS total
           FROM telemetry_events
          WHERE organization_id = $1 AND ($2::uuid IS NULL OR operator_id = $2::uuid)
            AND start_at >= now() - interval '30 days'
          GROUP BY 1 ORDER BY total DESC LIMIT 6`,
        scope,
      ),
      one(
        `SELECT status, started_at, finished_at, duration_ms, stats
           FROM sync_runs
          WHERE organization_id = $1 AND ($2::uuid IS NULL OR operator_id = $2::uuid)
          ORDER BY started_at DESC LIMIT 1`,
        scope,
      ),
    ]);

    const payload = { frota, atividade, topKm, eventos, ultimaSync };
    await cacheSet(cacheKey, payload, 60);
    return payload;
  });
}
