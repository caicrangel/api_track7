import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Info,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, tokens } from '../lib/api';
import { useOperator } from '../lib/operator';
import { formatDateTime, formatNumber } from '../lib/format';
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
  Select,
  Spinner,
  StatCard,
  Table,
  Td,
  Th,
} from '../components/ui';

interface ModeloResposta {
  nome: string;
  fornecedor: string;
  origem: string;
  fusoHorario: string;
  formatos: string[];
  csv: Record<string, string>;
  ordenacao: string;
  nomeDoArquivo: string;
  dicionario: Array<{
    ordem: number;
    campo: string;
    tipo: string;
    significado: string;
    formato: string;
    exemplo: string;
  }>;
}

interface PreviewResposta {
  operador: { id: string; nome: string };
  veiculo: { assetId: number | string; numeroOrdem: string };
  periodo: { de: string; ate: string; fusoHorario: string };
  decendio: string;
  totalRegistros: number;
  colunas: Array<{ key: string; label: string }>;
  amostra: Array<Record<string, string | number>>;
  intervaloMedioSegundos: number | null;
}

interface Emissao {
  id: string;
  trip_external_id: string;
  asset_id: number | string;
  vehicle_order: string | null;
  period_from: string;
  period_to: string;
  decendio: string;
  format: string;
  file_name: string;
  row_count: number;
  content_sha256: string;
  created_at: string;
  created_by_name: string | null;
  operator_name: string;
}

/** Datas do formulário: datetime-local trabalha em horário local do navegador. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ContestacoesPage() {
  const { operatorId, operator } = useOperator();
  const [assetId, setAssetId] = useState('');
  const [tripExternalId, setTripExternalId] = useState('');
  const [from, setFrom] = useState(() => toLocalInput(new Date(Date.now() - 4 * 3600_000)));
  const [to, setTo] = useState(() => toLocalInput(new Date()));
  const [preview, setPreview] = useState<PreviewResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [showModelo, setShowModelo] = useState(false);

  const vehicles = useQuery({
    queryKey: ['vehicles-contestacao', operatorId],
    queryFn: () =>
      api<{ data: Array<{ asset_id: number | string; description: string | null; registration_number: string | null; fleet_number: string | null }> }>(
        '/vehicles',
        { query: { pageSize: 500, operatorId: operatorId ?? undefined } },
      ),
  });

  const viagens = useQuery({
    queryKey: ['viagens-contestacao', operatorId, assetId],
    queryFn: () =>
      api<{ viagens: Array<{ trip_id: number; trip_start: string; trip_end: string | null; distance_km: number | null }> }>(
        '/reports/sumob/viagens',
        { query: { assetId, operatorId: operatorId ?? undefined } },
      ),
    enabled: Boolean(assetId),
  });

  const emissoes = useQuery({
    queryKey: ['sumob-exports', operatorId],
    queryFn: () =>
      api<{ exports: Emissao[] }>('/reports/sumob/exports', {
        query: { operatorId: operatorId ?? undefined, limit: 50 },
      }),
  });

  useEffect(() => {
    setPreview(null);
  }, [assetId, from, to, operatorId]);

  const conferir = useMutation({
    mutationFn: () =>
      api<PreviewResposta>('/reports/sumob/preview', {
        method: 'POST',
        body: {
          operatorId: operatorId ?? undefined,
          assetId,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        },
      }),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err: Error) => {
      setPreview(null);
      setError(err.message);
    },
  });

  /**
   * O download precisa de POST com corpo, então não dá para usar um link:
   * busca o arquivo com o cabeçalho de autenticação e salva pelo blob.
   */
  const baixar = async (format: 'xlsx' | 'csv') => {
    setError(null);
    setBaixando(format);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/reports/sumob/arquivo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.access}`,
        },
        body: JSON.stringify({
          operatorId: operatorId ?? undefined,
          assetId,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          tripExternalId,
          format,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Falha ao emitir (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${tripExternalId.trim()}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      void emissoes.refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBaixando(null);
    }
  };

  const pronto = Boolean(assetId && tripExternalId.trim() && preview && preview.totalRegistros > 0);
  const intervalo = preview?.intervaloMedioSegundos ?? null;

  return (
    <>
      <PageHeader
        icon={<FileCheck2 className="h-6 w-6" />}
        title="Contestações"
        subtitle={
          operator
            ? `Relatório georreferenciado de viagem — ${operator.shortName ?? operator.name}.`
            : 'Relatório georreferenciado de viagem, no modelo exigido pela SMMUR/SUMOB.'
        }
        actions={
          <Button icon={<Info className="h-4 w-4" />} onClick={() => setShowModelo(true)}>
            Modelo e dicionário
          </Button>
        }
      />

      <div className="mb-4">
        <Alert tone="info">
          Um arquivo por viagem contestada, nomeado com o <strong>ID da planilha de apuração</strong>, extraído
          direto da API da Track7 — sem edição manual, como exigem as alíneas (e), (f) e (g) do ofício.
        </Alert>
      </div>

      <Card className="mb-4 p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Veículo" hint="O número de ordem sai do cadastro da Track7.">
            <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Selecione…</option>
              {vehicles.data?.data.map((v) => (
                <option key={v.asset_id} value={v.asset_id}>
                  {v.fleet_number ? `${v.fleet_number} · ` : ''}
                  {v.description ?? `Ativo ${v.asset_id}`}
                  {v.registration_number ? ` (${v.registration_number})` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="ID da viagem (planilha de apuração)" hint="Nomeia o arquivo — sem espaços ou barras.">
            <Input
              value={tripExternalId}
              onChange={(e) => setTripExternalId(e.target.value)}
              placeholder="ID41257202604131231"
            />
          </Field>

          <Field label="Início do período">
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>

          <Field label="Fim do período">
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {viagens.data?.viagens?.length ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Viagens sincronizadas deste veículo — clique para preencher o período
            </p>
            <div className="flex flex-wrap gap-2">
              {viagens.data.viagens.slice(0, 12).map((t) => (
                <button
                  key={t.trip_id}
                  onClick={() => {
                    setFrom(toLocalInput(new Date(t.trip_start)));
                    if (t.trip_end) setTo(toLocalInput(new Date(t.trip_end)));
                  }}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-200"
                >
                  {formatDateTime(t.trip_start)}
                  {t.distance_km ? ` · ${formatNumber(t.distance_km, 1)} km` : ''}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error && (
          <div className="mt-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            icon={<Search className="h-4 w-4" />}
            loading={conferir.isPending}
            disabled={!assetId}
            onClick={() => conferir.mutate()}
          >
            Conferir registros
          </Button>
          <Button
            variant="primary"
            icon={<FileSpreadsheet className="h-4 w-4" />}
            loading={baixando === 'xlsx'}
            disabled={!pronto}
            onClick={() => void baixar('xlsx')}
          >
            Emitir XLSX
          </Button>
          <Button
            icon={<Download className="h-4 w-4" />}
            loading={baixando === 'csv'}
            disabled={!pronto}
            onClick={() => void baixar('csv')}
          >
            Emitir CSV
          </Button>
        </div>
      </Card>

      {preview && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Registros no período"
              value={formatNumber(preview.totalRegistros)}
              tone={preview.totalRegistros > 0 ? 'success' : 'danger'}
            />
            <StatCard label="Número de ordem" value={preview.veiculo.numeroOrdem || '—'} />
            <StatCard
              label="Intervalo médio"
              value={intervalo !== null ? `${intervalo}s` : '—'}
              hint="entre pings consecutivos"
              tone={intervalo !== null && intervalo > 120 ? 'warning' : 'default'}
            />
            <StatCard label="Decêndio" value={preview.decendio} hint="para a pasta da alínea (h)" />
          </div>

          {intervalo !== null && intervalo > 120 && (
            <div className="mb-4">
              <Alert tone="warning" title="Densidade de pings baixa">
                Um registro a cada {intervalo}s pode deixar trechos curtos do itinerário sem cobertura. O critério
                da Portaria SUMOB 048/2026 exige ping em pelo menos 90% dos trechos — vale conferir antes de
                contestar.
              </Alert>
            </div>
          )}

          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Amostra do arquivo ({preview.amostra.length} de {formatNumber(preview.totalRegistros)} linhas)
              </h3>
              <span className="text-xs text-slate-500">
                Horário local · {preview.periodo.fusoHorario}
              </span>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {preview.colunas.map((c) => (
                      <Th key={c.key}>{c.label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.amostra.map((row, index) => (
                    <tr key={index}>
                      {preview.colunas.map((c) => (
                        <Td key={c.key} className="font-mono text-xs">
                          {String(row[c.key] ?? '')}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">Arquivos emitidos</h3>
        </div>
        {emissoes.isLoading ? (
          <Spinner />
        ) : !emissoes.data?.exports.length ? (
          <EmptyState title="Nenhum arquivo emitido" description="Os arquivos gerados ficam registrados aqui, com o hash do conteúdo." />
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <Th>Arquivo</Th>
                  <Th>Empresa</Th>
                  <Th>Nº ordem</Th>
                  <Th>Período</Th>
                  <Th>Decêndio</Th>
                  <Th>Linhas</Th>
                  <Th>SHA-256</Th>
                  <Th>Emitido</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emissoes.data.exports.map((e) => (
                  <tr key={e.id}>
                    <Td className="font-mono text-xs">{e.file_name}</Td>
                    <Td className="max-w-[160px] truncate">{e.operator_name}</Td>
                    <Td>{e.vehicle_order ?? '—'}</Td>
                    <Td className="text-xs">
                      {formatDateTime(e.period_from)} → {formatDateTime(e.period_to)}
                    </Td>
                    <Td>
                      <Badge tone="neutral">{e.decendio}</Badge>
                    </Td>
                    <Td>{formatNumber(e.row_count)}</Td>
                    <Td className="font-mono text-[10px] text-slate-400" title={e.content_sha256}>
                      {e.content_sha256.slice(0, 12)}…
                    </Td>
                    <Td className="text-xs">
                      {formatDateTime(e.created_at)}
                      {e.created_by_name ? ` · ${e.created_by_name}` : ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <ModeloModal open={showModelo} onClose={() => setShowModelo(false)} />
    </>
  );
}

/** Modelo e dicionário de dados — é o material da validação da alínea (b) e (l). */
function ModeloModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['sumob-modelo'],
    queryFn: () => api<ModeloResposta>('/reports/sumob/modelo'),
    enabled: open,
  });

  const baixarDicionario = async () => {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL ?? '/api'}/reports/sumob/modelo?format=csv`,
      { headers: { Authorization: `Bearer ${tokens.access}` } },
    );
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dicionario-de-dados-track7.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Modelo do relatório e dicionário de dados"
      subtitle="Material a submeter à validação da SMMUR e da SUMOB (alíneas b e l)."
      footer={
        <>
          <Button icon={<Download className="h-4 w-4" />} onClick={() => void baixarDicionario()}>
            Baixar dicionário (CSV)
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Linha termo="Relatório" valor={data.nome} />
            <Linha termo="Fornecedor" valor={data.fornecedor} />
            <Linha termo="Origem" valor={data.origem} />
            <Linha termo="Fuso horário" valor={data.fusoHorario} />
            <Linha termo="Ordenação" valor={data.ordenacao} />
            <Linha termo="Nome do arquivo" valor={data.nomeDoArquivo} />
            <Linha termo="CSV" valor={`campos "${data.csv.separadorDeCampos}" · decimal "${data.csv.separadorDecimal}" · ${data.csv.codificacao}`} />
            <Linha termo="Formatos" valor={data.formatos.join(', ').toUpperCase()} />
          </dl>

          <Table fixed>
            <thead className="bg-slate-50">
              <tr>
                <Th className="w-8">#</Th>
                <Th className="w-32">Campo</Th>
                <Th className="w-20">Tipo</Th>
                <Th className="w-1/4">Significado</Th>
                <Th className="w-1/3">Formato</Th>
                <Th className="w-28">Exemplo</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.dicionario.map((item) => (
                <tr key={item.campo}>
                  <Td>{item.ordem}</Td>
                  <Td wrap className="font-mono text-xs font-medium">{item.campo}</Td>
                  <Td>{item.tipo}</Td>
                  <Td wrap className="text-xs">{item.significado}</Td>
                  <Td wrap className="text-xs">{item.formato}</Td>
                  <Td wrap className="font-mono text-xs">{item.exemplo}</Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <Alert tone="warning" title="Antes de usar em contestação">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A alínea (b) exige que este modelo seja previamente validado pela SMMUR e pela SUMOB. Submeta
                esta definição e só depois emita arquivos para instrução das contestações.
              </span>
            </div>
          </Alert>
        </div>
      )}
    </Modal>
  );
}

function Linha({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{termo}:</dt>
      <dd className="font-medium text-slate-800">{valor}</dd>
    </div>
  );
}
