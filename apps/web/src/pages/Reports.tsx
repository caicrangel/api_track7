import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, History, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useOperator } from '../lib/operator';
import { formatByType, formatDateTime, formatNumber } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface ReportParam {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: string | number | null;
  help?: string;
}

interface ReportColumn {
  key: string;
  label: string;
  type?: string;
}

interface ReportDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  params: ReportParam[];
  columns: ReportColumn[];
}

interface ReportResult {
  report: { code: string; name: string; columns: ReportColumn[] };
  data: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  generatedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  FROTA: 'Frota',
  OPERACAO: 'Operação',
  SEGURANCA: 'Segurança',
  CONFORMIDADE: 'Conformidade',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { operatorId, operator } = useOperator();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const catalog = useQuery({
    queryKey: ['reports-catalog'],
    queryFn: () => api<{ reports: ReportDefinition[] }>('/reports'),
  });

  const history = useQuery({
    queryKey: ['reports-history'],
    queryFn: () =>
      api<{
        executions: Array<{
          id: string;
          report_code: string;
          status: string;
          row_count: number;
          duration_ms: number;
          created_at: string;
          created_by_name: string | null;
          operator_name: string | null;
        }>;
      }>('/reports/executions'),
    enabled: showHistory,
  });

  const reports = catalog.data?.reports ?? [];
  const selected = reports.find((r) => r.code === selectedCode) ?? null;

  useEffect(() => {
    if (!selectedCode && reports.length) setSelectedCode(reports[0].code);
  }, [reports, selectedCode]);

  useEffect(() => {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const param of selected.params) {
      if (param.name === 'from') next.from = daysAgo(30);
      else if (param.name === 'to') next.to = today();
      else if (param.defaultValue !== undefined && param.defaultValue !== null) next[param.name] = String(param.defaultValue);
      else next[param.name] = '';
    }
    setParams(next);
    setResult(null);
    setError(null);
  }, [selected?.code]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReportDefinition[]>();
    for (const report of reports) {
      const list = map.get(report.category) ?? [];
      list.push(report);
      map.set(report.category, list);
    }
    return [...map.entries()];
  }, [reports]);

  const runReport = useMutation({
    mutationFn: () =>
      api<ReportResult>(`/reports/${selectedCode}/run`, {
        method: 'POST',
        body: { params, format: 'json', operatorId: operatorId ?? undefined },
      }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err: Error) => {
      setResult(null);
      setError(err.message);
    },
  });

  const handleExport = async () => {
    if (!selectedCode) return;
    setExporting(true);
    try {
      await downloadFile(
        `/reports/${selectedCode}/run`,
        `${selectedCode}-${today()}.csv`,
        { method: 'POST', body: { params, format: 'csv', operatorId: operatorId ?? undefined } },
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        icon={<FileBarChart className="h-6 w-6" />}
        title="Relatórios"
        subtitle={
          operator
            ? `Relatórios de ${operator.shortName ?? operator.name}.`
            : 'Relatórios consolidados de todas as empresas operadoras.'
        }
        actions={
          <Button icon={<History className="h-4 w-4" />} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Ocultar histórico' : 'Histórico'}
          </Button>
        }
      />

      {showHistory && (
        <Card className="mb-4 overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            Execuções recentes
          </h2>
          {history.isLoading ? (
            <Spinner />
          ) : !history.data?.executions.length ? (
            <EmptyState title="Nenhuma execução registrada" />
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Relatório</Th>
                  <Th>Empresa</Th>
                  <Th>Situação</Th>
                  <Th>Linhas</Th>
                  <Th>Duração</Th>
                  <Th>Usuário</Th>
                  <Th>Quando</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.data.executions.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.report_code}</Td>
                    <Td>{item.operator_name ?? 'Consolidado'}</Td>
                    <Td>
                      <Badge tone={item.status === 'SUCCESS' ? 'success' : 'danger'}>{item.status}</Badge>
                    </Td>
                    <Td>{formatNumber(item.row_count)}</Td>
                    <Td>{formatNumber(item.duration_ms)} ms</Td>
                    <Td>{item.created_by_name ?? '—'}</Td>
                    <Td>{formatDateTime(item.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            Catálogo
          </h2>
          {catalog.isLoading ? (
            <Spinner />
          ) : (
            <div className="max-h-[640px] overflow-y-auto p-2">
              {grouped.map(([category, items]) => (
                <div key={category} className="mb-2">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {CATEGORY_LABELS[category] ?? category}
                  </p>
                  {items.map((report) => (
                    <button
                      key={report.code}
                      onClick={() => setSelectedCode(report.code)}
                      className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        report.code === selectedCode
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {report.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {selected && (
            <Card className="p-5">
              <h2 className="text-base font-semibold text-slate-900">{selected.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{selected.description}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {selected.params.map((param) => (
                  <ParamField
                    key={param.name}
                    param={param}
                    value={params[param.name] ?? ''}
                    onChange={(value) => setParams((prev) => ({ ...prev, [param.name]: value }))}
                  />
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon={<Play className="h-4 w-4" />}
                  loading={runReport.isPending}
                  onClick={() => runReport.mutate()}
                >
                  Gerar relatório
                </Button>
                <Button icon={<Download className="h-4 w-4" />} loading={exporting} onClick={handleExport}>
                  Exportar CSV
                </Button>
              </div>

              {error && (
                <div className="mt-4">
                  <Alert tone="danger">{error}</Alert>
                </div>
              )}
            </Card>
          )}

          {result && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-800">{result.report.name}</h3>
                <span className="text-xs text-slate-500">
                  {formatNumber(result.rowCount)} linha(s) · {formatNumber(result.durationMs)} ms ·{' '}
                  {formatDateTime(result.generatedAt)}
                </span>
              </div>
              {result.data.length ? (
                <div className="max-h-[560px] overflow-auto">
                  <Table>
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {visibleColumns(result.report.columns, operatorId).map((column) => (
                          <Th key={column.key}>{column.label}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.data.map((row, index) => (
                        <tr key={index} className="hover:bg-slate-50/70">
                          {visibleColumns(result.report.columns, operatorId).map((column) => (
                            <Td key={column.key}>{formatByType(row[column.key], column.type)}</Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title="Nenhum registro encontrado"
                  description="Ajuste o período ou os filtros e gere novamente."
                />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** A coluna "Empresa operadora" só faz sentido na visão consolidada. */
function visibleColumns(columns: ReportColumn[], operatorId: string | null): ReportColumn[] {
  return operatorId ? columns.filter((c) => c.key !== 'empresa') : columns;
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ReportParam;
  value: string;
  onChange: (value: string) => void;
}) {
  const vehicles = useQuery({
    queryKey: ['vehicles-options'],
    queryFn: () => api<{ data: Array<{ asset_id: number; description: string | null; registration_number: string | null }> }>(
      '/vehicles',
      { query: { pageSize: 500 } },
    ),
    enabled: param.type === 'select-vehicle',
  });

  const sites = useQuery({
    queryKey: ['vehicles-filters'],
    queryFn: () => api<{ sites: Array<{ value: number; label: string }> }>('/vehicles/filters'),
    enabled: param.type === 'select-site',
  });

  const drivers = useQuery({
    queryKey: ['drivers-options'],
    queryFn: () => api<{ data: Array<{ driver_id: number; name: string | null }> }>('/drivers', {
      query: { pageSize: 500 },
    }),
    enabled: param.type === 'select-driver',
  });

  if (param.type === 'select-vehicle') {
    return (
      <Field label={param.label} hint={param.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Todos os veículos</option>
          {vehicles.data?.data.map((v) => (
            <option key={v.asset_id} value={v.asset_id}>
              {v.description ?? `Ativo ${v.asset_id}`} {v.registration_number ? `· ${v.registration_number}` : ''}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (param.type === 'select-site') {
    return (
      <Field label={param.label} hint={param.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Todos os grupos</option>
          {sites.data?.sites.map((site) => (
            <option key={site.value} value={site.value}>
              {site.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (param.type === 'select-driver') {
    return (
      <Field label={param.label} hint={param.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Todos os motoristas</option>
          {drivers.data?.data.map((d) => (
            <option key={d.driver_id} value={d.driver_id}>
              {d.name ?? `Motorista ${d.driver_id}`}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <Field label={param.label} hint={param.help}>
      <Input
        type={param.type === 'date' ? 'date' : param.type === 'number' ? 'number' : 'text'}
        value={value}
        required={param.required}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
