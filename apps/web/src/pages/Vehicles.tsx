import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Download,
  Gauge,
  MapPin,
  RefreshCw,
  Search,
  Truck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useOperator } from '../lib/operator';
import { formatDateTime, formatDuration, formatNumber, timeAgo } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../components/ui';

interface Vehicle {
  asset_id: number;
  description: string | null;
  registration_number: string | null;
  fleet_number: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  fuel_type: string | null;
  vin_number: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  odometer_km: number | null;
  engine_hours_seconds: number | null;
  site_id: number | null;
  site_name: string | null;
  default_driver_name: string | null;
  last_contact_at: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  formatted_address: string | null;
  connectivity: 'MOVENDO' | 'PARADO' | 'SEM_COMUNICACAO';
  synced_at: string | null;
  operator_id?: string;
  operator_name?: string | null;
}

interface VehicleListResponse {
  data: Vehicle[];
  page: number;
  pageSize: number;
  total: number;
}

interface SummaryResponse {
  summary: {
    total: number;
    ativos: number;
    movendo: number;
    parados: number;
    sem_comunicacao: number;
    odometro_total: number;
    ultima_transmissao: string | null;
  };
  byType: Array<{ label: string; total: number }>;
  bySite: Array<{ label: string; total: number }>;
}

interface FiltersResponse {
  makes: string[];
  fuelTypes: string[];
  sites: Array<{ value: number; label: string; total: number }>;
}

const CONNECTIVITY_LABELS: Record<Vehicle['connectivity'], { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  MOVENDO: { label: 'Em movimento', tone: 'success' },
  PARADO: { label: 'Parado', tone: 'neutral' },
  SEM_COMUNICACAO: { label: 'Sem comunicação', tone: 'warning' },
};

export function VehiclesPage() {
  const { operatorId, operator } = useOperator();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [connectivity, setConnectivity] = useState('');
  const [siteId, setSiteId] = useState('');
  const [make, setMake] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // debounce da busca para não disparar uma consulta por tecla digitada
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const query = {
    search: debounced,
    connectivity,
    siteId,
    make,
    page,
    pageSize: 25,
    operatorId: operatorId ?? undefined,
  };

  const vehicles = useQuery({
    queryKey: ['vehicles', query],
    queryFn: () => api<VehicleListResponse>('/vehicles', { query }),
  });
  const summary = useQuery({
    queryKey: ['vehicles-summary', operatorId],
    queryFn: () => api<SummaryResponse>('/vehicles/summary', { query: { operatorId: operatorId ?? undefined } }),
  });
  const filters = useQuery({
    queryKey: ['vehicles-filters', operatorId],
    queryFn: () => api<FiltersResponse>('/vehicles/filters', { query: { operatorId: operatorId ?? undefined } }),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/vehicles/export', `veiculos-${new Date().toISOString().slice(0, 10)}.csv`, {
        query: { search: debounced, connectivity, siteId, make, operatorId: operatorId ?? undefined },
      });
    } finally {
      setExporting(false);
    }
  };

  const stats = summary.data?.summary;

  return (
    <>
      <PageHeader
        icon={<Truck className="h-6 w-6" />}
        title="Veículos"
        subtitle={
          operator
            ? `Frota de ${operator.shortName ?? operator.name}, sincronizada da API oficial da Track7.`
            : 'Frota consolidada de todas as empresas operadoras.'
        }
        actions={
          <>
            <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => { void vehicles.refetch(); void summary.refetch(); }}>
              Atualizar
            </Button>
            <Button variant="primary" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={handleExport}>
              Exportar CSV
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total de veículos" value={formatNumber(stats?.total)} icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Em movimento" value={formatNumber(stats?.movendo)} tone="success" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Parados" value={formatNumber(stats?.parados)} icon={<MapPin className="h-5 w-5" />} />
        <StatCard
          label="Sem comunicação"
          value={formatNumber(stats?.sem_comunicacao)}
          hint="mais de 24 h"
          tone={(stats?.sem_comunicacao ?? 0) > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Buscar" className="md:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Descrição, placa, nº de frota ou chassi"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Situação">
            <Select value={connectivity} onChange={(e) => { setConnectivity(e.target.value); setPage(1); }}>
              <option value="">Todas</option>
              <option value="MOVENDO">Em movimento</option>
              <option value="PARADO">Parado</option>
              <option value="SEM_COMUNICACAO">Sem comunicação</option>
            </Select>
          </Field>
          <Field label="Grupo / Site">
            <Select value={siteId} onChange={(e) => { setSiteId(e.target.value); setPage(1); }}>
              <option value="">Todos</option>
              {filters.data?.sites.map((site) => (
                <option key={site.value} value={site.value}>
                  {site.label} ({site.total})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {filters.data?.makes.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Marca:</span>
            <button
              onClick={() => { setMake(''); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs ${make === '' ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-600'}`}
            >
              Todas
            </button>
            {filters.data.makes.map((item) => (
              <button
                key={item}
                onClick={() => { setMake(item); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs ${make === item ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        {vehicles.isLoading ? (
          <Spinner label="Carregando veículos..." />
        ) : vehicles.error ? (
          <div className="p-4">
            <Alert tone="danger">Não foi possível carregar a lista de veículos.</Alert>
          </div>
        ) : !vehicles.data?.data.length ? (
          <EmptyState
            icon={<Truck className="h-10 w-10" />}
            title="Nenhum veículo encontrado"
            description="Ajuste os filtros ou execute uma sincronização em Configurações › Integrações."
          />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Veículo</Th>
                  {!operatorId && <Th>Empresa</Th>}
                  <Th>Placa</Th>
                  <Th>Grupo / Site</Th>
                  <Th className="hidden 2xl:table-cell">Marca / Modelo</Th>
                  <Th>Odômetro</Th>
                  <Th>Situação</Th>
                  <Th>Última transmissão</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.data.data.map((vehicle) => {
                  const badge = CONNECTIVITY_LABELS[vehicle.connectivity];
                  return (
                    <tr
                      key={vehicle.asset_id}
                      onClick={() => setSelected(vehicle.asset_id)}
                      className="cursor-pointer hover:bg-slate-50/70"
                    >
                      <Td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <Truck className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{vehicle.description ?? `Ativo ${vehicle.asset_id}`}</p>
                            <p className="text-xs text-slate-400">
                              {vehicle.fleet_number ? `Frota ${vehicle.fleet_number}` : `ID ${vehicle.asset_id}`}
                            </p>
                          </div>
                        </div>
                      </Td>
                      {!operatorId && <Td className="max-w-[180px] truncate">{vehicle.operator_name ?? '—'}</Td>}
                      <Td className="font-mono text-xs uppercase">{vehicle.registration_number ?? '—'}</Td>
                      <Td className="max-w-[220px] truncate">{vehicle.site_name ?? '—'}</Td>
                      <Td className="hidden 2xl:table-cell">
                        <span className="text-slate-700">{vehicle.make ?? '—'}</span>
                        {vehicle.model && <span className="text-slate-400"> · {vehicle.model}</span>}
                      </Td>
                      <Td>{vehicle.odometer_km !== null ? `${formatNumber(vehicle.odometer_km, 0)} km` : '—'}</Td>
                      <Td>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </Td>
                      <Td>
                        <span title={formatDateTime(vehicle.last_contact_at)}>{timeAgo(vehicle.last_contact_at)}</span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={vehicles.data.page}
              pageSize={vehicles.data.pageSize}
              total={vehicles.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <VehicleDetailModal assetId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

interface VehicleDetail {
  vehicle: Vehicle;
  trips: Array<{
    trip_id: number;
    trip_start: string;
    trip_end: string | null;
    distance_km: number | null;
    duration_seconds: number | null;
    max_speed_kmh: number | null;
    start_address: string | null;
    end_address: string | null;
  }>;
  events: Array<{
    event_id: number;
    event_category: string | null;
    event_description: string | null;
    start_at: string;
    value: number | null;
    value_units: string | null;
  }>;
  stats: { viagens_30d: number; km_30d: number; conducao_30d_seg: number; velocidade_maxima_30d: number } | null;
}

function VehicleDetailModal({ assetId, onClose }: { assetId: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['vehicle', assetId],
    queryFn: () => api<VehicleDetail>(`/vehicles/${assetId}`),
    enabled: assetId !== null,
  });

  const vehicle = data?.vehicle;

  return (
    <Modal
      open={assetId !== null}
      onClose={onClose}
      size="xl"
      title={vehicle?.description ?? 'Detalhes do veículo'}
      subtitle={vehicle ? `Placa ${vehicle.registration_number ?? '—'} · ID Track7 ${vehicle.asset_id}` : undefined}
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Viagens (30 d)" value={formatNumber(data.stats?.viagens_30d)} />
            <StatCard label="Distância (30 d)" value={`${formatNumber(data.stats?.km_30d, 1)} km`} />
            <StatCard label="Condução (30 d)" value={formatDuration(data.stats?.conducao_30d_seg)} />
            <StatCard label="Vel. máx. (30 d)" value={`${formatNumber(data.stats?.velocidade_maxima_30d, 1)} km/h`} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Cadastro</h3>
              <dl className="space-y-2 text-sm">
                <Row label="Marca / Modelo" value={[vehicle?.make, vehicle?.model].filter(Boolean).join(' · ') || '—'} />
                <Row label="Ano" value={vehicle?.year ?? '—'} />
                <Row label="Chassi (VIN)" value={vehicle?.vin_number ?? '—'} />
                <Row label="Combustível" value={vehicle?.fuel_type ?? '—'} />
                <Row label="Grupo / Site" value={vehicle?.site_name ?? '—'} />
                <Row label="Motorista padrão" value={vehicle?.default_driver_name ?? '—'} />
                <Row label="Odômetro" value={vehicle?.odometer_km !== null && vehicle?.odometer_km !== undefined ? `${formatNumber(vehicle.odometer_km, 1)} km` : '—'} />
                <Row label="Horímetro" value={formatDuration(vehicle?.engine_hours_seconds)} />
                <Row label="Sincronizado em" value={formatDateTime(vehicle?.synced_at)} />
              </dl>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Gauge className="h-4 w-4 text-slate-400" />
                Última posição
              </h3>
              <dl className="space-y-2 text-sm">
                <Row label="Registrada em" value={formatDateTime(vehicle?.last_contact_at)} />
                <Row label="Velocidade" value={vehicle?.speed_kmh !== null && vehicle?.speed_kmh !== undefined ? `${formatNumber(vehicle.speed_kmh, 0)} km/h` : '—'} />
                <Row label="Endereço" value={vehicle?.formatted_address ?? '—'} />
                <Row
                  label="Coordenadas"
                  value={
                    vehicle?.latitude && vehicle?.longitude
                      ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}`
                      : '—'
                  }
                />
              </dl>
              {vehicle?.latitude && vehicle?.longitude && (
                <a
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
                  href={`https://www.google.com/maps?q=${vehicle.latitude},${vehicle.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-4 w-4" /> Abrir no mapa
                </a>
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
              Últimas viagens
            </h3>
            {data.trips.length ? (
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Início</Th>
                    <Th>Fim</Th>
                    <Th>Distância</Th>
                    <Th>Duração</Th>
                    <Th>Vel. máx.</Th>
                    <Th>Origem → Destino</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.trips.map((trip) => (
                    <tr key={trip.trip_id}>
                      <Td>{formatDateTime(trip.trip_start)}</Td>
                      <Td>{formatDateTime(trip.trip_end)}</Td>
                      <Td>{formatNumber(trip.distance_km, 1)} km</Td>
                      <Td>{formatDuration(trip.duration_seconds)}</Td>
                      <Td>{formatNumber(trip.max_speed_kmh, 0)} km/h</Td>
                      <Td className="max-w-[280px] truncate" >
                        {(trip.start_address ?? '—') + ' → ' + (trip.end_address ?? '—')}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Sem viagens sincronizadas" />
            )}
          </Card>

          <Card className="overflow-hidden">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
              Últimos eventos
            </h3>
            {data.events.length ? (
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Ocorrência</Th>
                    <Th>Categoria</Th>
                    <Th>Descrição</Th>
                    <Th>Valor</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.events.map((event) => (
                    <tr key={event.event_id}>
                      <Td>{formatDateTime(event.start_at)}</Td>
                      <Td>{event.event_category ?? '—'}</Td>
                      <Td>{event.event_description ?? '—'}</Td>
                      <Td>
                        {event.value !== null ? `${formatNumber(event.value, 1)} ${event.value_units ?? ''}`.trim() : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Sem eventos sincronizados" />
            )}
          </Card>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
