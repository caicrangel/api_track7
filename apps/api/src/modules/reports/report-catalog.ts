/**
 * Catálogo de relatórios do sistema.
 *
 * Cada relatório declara seus parâmetros e colunas — o front-end monta o
 * formulário e a tabela a partir daqui, sem código específico por relatório.
 * É este o ponto de extensão para as exigências do órgão gestor.
 */

export type ParamType = 'date' | 'datetime' | 'number' | 'text' | 'select-vehicle' | 'select-site' | 'select-driver';

export interface ReportParam {
  name: string;
  label: string;
  type: ParamType;
  required?: boolean;
  defaultValue?: string | number | null;
  help?: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'datetime' | 'duration' | 'decimal';
}

export interface ReportDefinition {
  code: string;
  name: string;
  description: string;
  category: 'FROTA' | 'OPERACAO' | 'SEGURANCA' | 'CONFORMIDADE';
  params: ReportParam[];
  columns: ReportColumn[];
  build: (organizationId: string, params: Record<string, unknown>) => { sql: string; values: unknown[] };
}

const periodParams: ReportParam[] = [
  { name: 'from', label: 'Início', type: 'date', required: true },
  { name: 'to', label: 'Fim', type: 'date', required: true },
];

function period(params: Record<string, unknown>, defaultDays = 30): [Date, Date] {
  const to = params.to ? new Date(String(params.to)) : new Date();
  const from = params.from ? new Date(String(params.from)) : new Date(to.getTime() - defaultDays * 86400_000);
  // "to" informado como data pura cobre o dia inteiro
  if (params.to && String(params.to).length <= 10) to.setUTCHours(23, 59, 59, 999);
  return [from, to];
}

export const REPORTS: ReportDefinition[] = [
  {
    code: 'inventario-frota',
    name: 'Inventário da frota',
    description: 'Relação completa dos veículos cadastrados na Track7, com identificação, grupo e situação de comunicação.',
    category: 'FROTA',
    params: [{ name: 'siteId', label: 'Grupo/Site', type: 'select-site' }],
    columns: [
      { key: 'asset_id', label: 'ID Track7' },
      { key: 'descricao', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'frota', label: 'Nº de frota' },
      { key: 'marca', label: 'Marca' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'ano', label: 'Ano' },
      { key: 'chassi', label: 'Chassi/VIN' },
      { key: 'combustivel', label: 'Combustível' },
      { key: 'grupo', label: 'Grupo/Site' },
      { key: 'odometro_km', label: 'Odômetro (km)', type: 'decimal' },
      { key: 'situacao', label: 'Situação' },
      { key: 'ultima_transmissao', label: 'Última transmissão', type: 'datetime' },
    ],
    build: (orgId, params) => ({
      sql: `
        SELECT v.asset_id,
               v.description            AS descricao,
               v.registration_number    AS placa,
               v.fleet_number           AS frota,
               v.make                   AS marca,
               v.model                  AS modelo,
               v.year                   AS ano,
               v.vin_number             AS chassi,
               v.fuel_type              AS combustivel,
               g.name                   AS grupo,
               v.odometer_km            AS odometro_km,
               CASE WHEN v.status = 'INACTIVE' THEN 'Inativo'
                    WHEN p.recorded_at IS NULL THEN 'Sem posição'
                    WHEN p.recorded_at < now() - interval '24 hours' THEN 'Sem comunicação'
                    WHEN coalesce(p.speed_kmh,0) > 3 THEN 'Em movimento'
                    ELSE 'Parado' END   AS situacao,
               p.recorded_at            AS ultima_transmissao
          FROM vehicles v
          LEFT JOIN vehicle_last_position p ON p.organization_id = v.organization_id AND p.asset_id = v.asset_id
          LEFT JOIN t7_groups g ON g.organization_id = v.organization_id AND g.group_id = v.site_id
         WHERE v.organization_id = $1
           AND ($2::bigint IS NULL OR v.site_id = $2::bigint)
         ORDER BY v.description NULLS LAST`,
      values: [orgId, params.siteId ? Number(params.siteId) : null],
    }),
  },

  {
    code: 'sem-transmissao',
    name: 'Veículos sem transmissão',
    description: 'Veículos que não transmitem posição há mais de N horas — indicador de equipamento com falha ou veículo recolhido.',
    category: 'OPERACAO',
    params: [
      { name: 'horas', label: 'Horas sem transmitir', type: 'number', required: true, defaultValue: 24 },
    ],
    columns: [
      { key: 'asset_id', label: 'ID Track7' },
      { key: 'descricao', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'grupo', label: 'Grupo/Site' },
      { key: 'ultima_transmissao', label: 'Última transmissão', type: 'datetime' },
      { key: 'horas_sem_transmitir', label: 'Horas sem transmitir', type: 'decimal' },
      { key: 'ultima_localizacao', label: 'Última localização' },
    ],
    build: (orgId, params) => ({
      sql: `
        SELECT v.asset_id,
               v.description         AS descricao,
               v.registration_number AS placa,
               g.name                AS grupo,
               p.recorded_at         AS ultima_transmissao,
               round(EXTRACT(EPOCH FROM (now() - p.recorded_at)) / 3600.0, 1) AS horas_sem_transmitir,
               p.formatted_address   AS ultima_localizacao
          FROM vehicles v
          LEFT JOIN vehicle_last_position p ON p.organization_id = v.organization_id AND p.asset_id = v.asset_id
          LEFT JOIN t7_groups g ON g.organization_id = v.organization_id AND g.group_id = v.site_id
         WHERE v.organization_id = $1
           AND v.status = 'ACTIVE'
           AND (p.recorded_at IS NULL OR p.recorded_at < now() - ($2 || ' hours')::interval)
         ORDER BY p.recorded_at ASC NULLS FIRST`,
      values: [orgId, Number(params.horas ?? 24)],
    }),
  },

  {
    code: 'quilometragem-periodo',
    name: 'Quilometragem por veículo',
    description: 'Distância percorrida, tempo em condução e tempo parado por veículo no período selecionado.',
    category: 'OPERACAO',
    params: [...periodParams, { name: 'siteId', label: 'Grupo/Site', type: 'select-site' }],
    columns: [
      { key: 'asset_id', label: 'ID Track7' },
      { key: 'descricao', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'grupo', label: 'Grupo/Site' },
      { key: 'viagens', label: 'Viagens', type: 'number' },
      { key: 'distancia_km', label: 'Distância (km)', type: 'decimal' },
      { key: 'tempo_conducao', label: 'Tempo em condução', type: 'duration' },
      { key: 'tempo_parado', label: 'Tempo parado', type: 'duration' },
      { key: 'velocidade_maxima', label: 'Velocidade máx. (km/h)', type: 'decimal' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params);
      return {
        sql: `
          SELECT v.asset_id,
                 v.description          AS descricao,
                 v.registration_number  AS placa,
                 g.name                 AS grupo,
                 count(t.trip_id)::int  AS viagens,
                 round(coalesce(sum(t.distance_km), 0), 2)   AS distancia_km,
                 coalesce(sum(t.driving_seconds), 0)::int    AS tempo_conducao,
                 coalesce(sum(t.standing_seconds), 0)::int   AS tempo_parado,
                 round(coalesce(max(t.max_speed_kmh), 0), 1) AS velocidade_maxima
            FROM vehicles v
            LEFT JOIN t7_groups g ON g.organization_id = v.organization_id AND g.group_id = v.site_id
            LEFT JOIN trips t ON t.organization_id = v.organization_id
                             AND t.asset_id = v.asset_id
                             AND t.trip_start BETWEEN $2 AND $3
           WHERE v.organization_id = $1
             AND ($4::bigint IS NULL OR v.site_id = $4::bigint)
           GROUP BY v.asset_id, v.description, v.registration_number, g.name
           ORDER BY distancia_km DESC`,
        values: [orgId, from, to, params.siteId ? Number(params.siteId) : null],
      };
    },
  },

  {
    code: 'viagens-detalhado',
    name: 'Viagens detalhadas',
    description: 'Cada viagem realizada no período, com origem, destino, distância e duração — base para prestação de contas.',
    category: 'CONFORMIDADE',
    params: [...periodParams, { name: 'assetId', label: 'Veículo', type: 'select-vehicle' }],
    columns: [
      { key: 'veiculo', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'motorista', label: 'Motorista' },
      { key: 'inicio', label: 'Início', type: 'datetime' },
      { key: 'fim', label: 'Fim', type: 'datetime' },
      { key: 'distancia_km', label: 'Distância (km)', type: 'decimal' },
      { key: 'duracao', label: 'Duração', type: 'duration' },
      { key: 'velocidade_maxima', label: 'Vel. máx. (km/h)', type: 'decimal' },
      { key: 'origem', label: 'Origem' },
      { key: 'destino', label: 'Destino' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params, 7);
      return {
        sql: `
          SELECT v.description         AS veiculo,
                 v.registration_number AS placa,
                 d.name                AS motorista,
                 t.trip_start          AS inicio,
                 t.trip_end            AS fim,
                 round(coalesce(t.distance_km, 0), 2) AS distancia_km,
                 coalesce(t.duration_seconds, 0)::int AS duracao,
                 round(coalesce(t.max_speed_kmh, 0), 1) AS velocidade_maxima,
                 t.start_address       AS origem,
                 t.end_address         AS destino
            FROM trips t
            JOIN vehicles v ON v.organization_id = t.organization_id AND v.asset_id = t.asset_id
            LEFT JOIN drivers d ON d.organization_id = t.organization_id AND d.driver_id = t.driver_id
           WHERE t.organization_id = $1
             AND t.trip_start BETWEEN $2 AND $3
             AND ($4::bigint IS NULL OR t.asset_id = $4::bigint)
           ORDER BY t.trip_start DESC
           LIMIT 50000`,
        values: [orgId, from, to, params.assetId ? Number(params.assetId) : null],
      };
    },
  },

  {
    code: 'excesso-velocidade',
    name: 'Excesso de velocidade',
    description: 'Ocorrências de velocidade acima do limite registradas pela telemetria, por veículo e motorista.',
    category: 'SEGURANCA',
    params: [...periodParams],
    columns: [
      { key: 'veiculo', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'motorista', label: 'Motorista' },
      { key: 'ocorrido_em', label: 'Ocorrência', type: 'datetime' },
      { key: 'valor', label: 'Velocidade registrada', type: 'decimal' },
      { key: 'limite', label: 'Limite (km/h)', type: 'decimal' },
      { key: 'duracao', label: 'Duração', type: 'duration' },
      { key: 'local', label: 'Local' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params);
      return {
        sql: `
          SELECT v.description         AS veiculo,
                 v.registration_number AS placa,
                 d.name                AS motorista,
                 e.start_at            AS ocorrido_em,
                 e.value               AS valor,
                 e.speed_limit         AS limite,
                 coalesce(e.total_seconds, 0)::int AS duracao,
                 e.start_address       AS local
            FROM telemetry_events e
            JOIN vehicles v ON v.organization_id = e.organization_id AND v.asset_id = e.asset_id
            LEFT JOIN drivers d ON d.organization_id = e.organization_id AND d.driver_id = e.driver_id
           WHERE e.organization_id = $1
             AND e.start_at BETWEEN $2 AND $3
             AND (e.event_category ILIKE '%speed%' OR e.event_description ILIKE '%veloc%'
                  OR e.event_description ILIKE '%speed%')
           ORDER BY e.start_at DESC
           LIMIT 50000`,
        values: [orgId, from, to],
      };
    },
  },

  {
    code: 'eventos-categoria',
    name: 'Eventos por categoria',
    description: 'Consolidado de eventos de telemetria agrupados por categoria e veículo — visão de comportamento da frota.',
    category: 'SEGURANCA',
    params: [...periodParams],
    columns: [
      { key: 'categoria', label: 'Categoria' },
      { key: 'veiculo', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'ocorrencias', label: 'Ocorrências', type: 'number' },
      { key: 'tempo_total', label: 'Tempo total', type: 'duration' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params);
      return {
        sql: `
          SELECT coalesce(nullif(e.event_category, ''), 'Não classificado') AS categoria,
                 v.description         AS veiculo,
                 v.registration_number AS placa,
                 count(*)::int         AS ocorrencias,
                 coalesce(sum(e.total_seconds), 0)::int AS tempo_total
            FROM telemetry_events e
            JOIN vehicles v ON v.organization_id = e.organization_id AND v.asset_id = e.asset_id
           WHERE e.organization_id = $1 AND e.start_at BETWEEN $2 AND $3
           GROUP BY 1, 2, 3
           ORDER BY ocorrencias DESC
           LIMIT 50000`,
        values: [orgId, from, to],
      };
    },
  },

  {
    code: 'conducao-motorista',
    name: 'Condução por motorista',
    description: 'Distância, tempo de condução e velocidade máxima por motorista identificado na telemetria.',
    category: 'OPERACAO',
    params: [...periodParams],
    columns: [
      { key: 'motorista', label: 'Motorista' },
      { key: 'matricula', label: 'Matrícula' },
      { key: 'viagens', label: 'Viagens', type: 'number' },
      { key: 'distancia_km', label: 'Distância (km)', type: 'decimal' },
      { key: 'tempo_conducao', label: 'Tempo em condução', type: 'duration' },
      { key: 'velocidade_maxima', label: 'Vel. máx. (km/h)', type: 'decimal' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params);
      return {
        sql: `
          SELECT coalesce(d.name, 'Não identificado') AS motorista,
                 d.employee_number       AS matricula,
                 count(t.trip_id)::int   AS viagens,
                 round(coalesce(sum(t.distance_km), 0), 2) AS distancia_km,
                 coalesce(sum(t.driving_seconds), 0)::int  AS tempo_conducao,
                 round(coalesce(max(t.max_speed_kmh), 0), 1) AS velocidade_maxima
            FROM trips t
            LEFT JOIN drivers d ON d.organization_id = t.organization_id AND d.driver_id = t.driver_id
           WHERE t.organization_id = $1 AND t.trip_start BETWEEN $2 AND $3
           GROUP BY 1, 2
           ORDER BY distancia_km DESC`,
        values: [orgId, from, to],
      };
    },
  },

  {
    code: 'utilizacao-frota',
    name: 'Utilização da frota',
    description: 'Dias com uso, ociosidade e aproveitamento de cada veículo no período — subsídio para dimensionamento da frota.',
    category: 'CONFORMIDADE',
    params: [...periodParams],
    columns: [
      { key: 'veiculo', label: 'Veículo' },
      { key: 'placa', label: 'Placa' },
      { key: 'dias_com_uso', label: 'Dias com uso', type: 'number' },
      { key: 'dias_periodo', label: 'Dias no período', type: 'number' },
      { key: 'aproveitamento_pct', label: 'Aproveitamento (%)', type: 'decimal' },
      { key: 'distancia_km', label: 'Distância (km)', type: 'decimal' },
    ],
    build: (orgId, params) => {
      const [from, to] = period(params);
      return {
        sql: `
          WITH dias AS (
            SELECT t.asset_id,
                   count(DISTINCT date_trunc('day', t.trip_start))::int AS dias_com_uso,
                   coalesce(sum(t.distance_km), 0) AS distancia_km
              FROM trips t
             WHERE t.organization_id = $1 AND t.trip_start BETWEEN $2 AND $3
             GROUP BY t.asset_id
          )
          SELECT v.description         AS veiculo,
                 v.registration_number AS placa,
                 coalesce(dias.dias_com_uso, 0) AS dias_com_uso,
                 GREATEST(1, (DATE_PART('day', $3::timestamptz - $2::timestamptz) + 1))::int AS dias_periodo,
                 round(100.0 * coalesce(dias.dias_com_uso, 0)
                       / GREATEST(1, (DATE_PART('day', $3::timestamptz - $2::timestamptz) + 1))::numeric, 1) AS aproveitamento_pct,
                 round(coalesce(dias.distancia_km, 0), 2) AS distancia_km
            FROM vehicles v
            LEFT JOIN dias ON dias.asset_id = v.asset_id
           WHERE v.organization_id = $1 AND v.status = 'ACTIVE'
           ORDER BY aproveitamento_pct ASC, v.description`,
        values: [orgId, from, to],
      };
    },
  },
];

export function findReport(code: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.code === code);
}
