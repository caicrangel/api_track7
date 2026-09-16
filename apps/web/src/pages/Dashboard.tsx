import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, LayoutDashboard, RefreshCw, Truck } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { formatDateTime, formatNumber, timeAgo } from '../lib/format';
import { Alert, Card, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';

interface DashboardData {
  frota: { total: number; ativos: number; movendo: number; sem_comunicacao: number } | null;
  atividade: Array<{ dia: string; km: number; viagens: number }>;
  topKm: Array<{ veiculo: string; placa: string; km: number }>;
  eventos: Array<{ categoria: string; total: number }>;
  ultimaSync: { status: string; started_at: string; duration_ms: number; stats: Record<string, number> } | null;
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Spinner label="Carregando indicadores..." />;
  if (error) return <Alert tone="danger">Não foi possível carregar o dashboard.</Alert>;

  const frota = data?.frota ?? { total: 0, ativos: 0, movendo: 0, sem_comunicacao: 0 };
  const semDados = frota.total === 0;

  return (
    <>
      <PageHeader
        icon={<LayoutDashboard className="h-6 w-6" />}
        title="Dashboard"
        subtitle="Visão geral da frota integrada à telemetria Track7."
      />

      {semDados && (
        <div className="mb-6">
          <Alert tone="info" title="Nenhum dado sincronizado ainda">
            Cadastre as credenciais em <strong>Configurações › Integrações</strong> e execute a primeira
            sincronização para popular o módulo de Veículos.
          </Alert>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Veículos" value={formatNumber(frota.total)} icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Ativos" value={formatNumber(frota.ativos)} tone="success" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Em movimento" value={formatNumber(frota.movendo)} hint="últimas 24 h" icon={<Activity className="h-5 w-5" />} />
        <StatCard
          label="Sem comunicação"
          value={formatNumber(frota.sem_comunicacao)}
          hint="mais de 24 h sem transmitir"
          tone={frota.sem_comunicacao > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Quilometragem diária (14 dias)</h2>
          {data?.atividade?.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.atividade.map((d) => ({ ...d, dia: new Date(d.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => `${formatNumber(v, 1)} km`} />
                <Line type="monotone" dataKey="km" stroke="#12934f" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Sem viagens no período" description="Os dados aparecem após a sincronização do histórico." />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Eventos por categoria (30 dias)</h2>
          {data?.eventos?.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.eventos} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="categoria"
                  width={110}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip />
                <Bar dataKey="total" fill="#42cf81" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Sem eventos registrados" />
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Veículos que mais rodaram (30 dias)</h2>
          {data?.topKm?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.topKm.map((item) => (
                <li key={`${item.veiculo}-${item.placa}`} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{item.veiculo ?? '—'}</p>
                    <p className="text-xs text-slate-400">{item.placa ?? 'sem placa'}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">{formatNumber(item.km, 1)} km</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Sem quilometragem no período" />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <RefreshCw className="h-4 w-4 text-slate-400" />
            Última sincronização
          </h2>
          {data?.ultimaSync ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Situação</span>
                <span
                  className={
                    data.ultimaSync.status === 'SUCCESS'
                      ? 'font-medium text-brand-600'
                      : 'font-medium text-amber-600'
                  }
                >
                  {data.ultimaSync.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Quando</span>
                <span className="text-slate-700">{timeAgo(data.ultimaSync.started_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Data</span>
                <span className="text-slate-700">{formatDateTime(data.ultimaSync.started_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Duração</span>
                <span className="text-slate-700">
                  {(data.ultimaSync.duration_ms ?? 0) < 1000
                    ? `${formatNumber(data.ultimaSync.duration_ms)} ms`
                    : `${formatNumber((data.ultimaSync.duration_ms ?? 0) / 1000, 1)} s`}
                </span>
              </div>
              {data.ultimaSync.stats && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {Object.entries(data.ultimaSync.stats).map(([key, value]) => (
                    <div key={key} className="flex justify-between py-0.5">
                      <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{formatNumber(value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="Nunca sincronizado" description="Configure a integração para começar." />
          )}
        </Card>
      </div>
    </>
  );
}
