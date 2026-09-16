import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  History,
  Network,
  Plug,
  RefreshCw,
  Save,
  ScrollText,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  Table,
  Td,
  Th,
  Toggle,
} from '../components/ui';

type Tab = 'organizacao' | 'integracoes' | 'auditoria';

const TABS: Array<{ key: Tab; label: string; icon: JSX.Element }> = [
  { key: 'organizacao', label: 'Organização', icon: <Building2 className="h-4 w-4" /> },
  { key: 'integracoes', label: 'Integrações', icon: <Plug className="h-4 w-4" /> },
  { key: 'auditoria', label: 'Auditoria', icon: <ScrollText className="h-4 w-4" /> },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('integracoes');

  return (
    <>
      <PageHeader
        icon={<Network className="h-6 w-6" />}
        title="Configurações"
        subtitle="Gerencie a organização, a integração com a Track7 e a trilha de auditoria."
      />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === item.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'organizacao' && <OrganizationTab />}
      {tab === 'integracoes' && <IntegrationTab />}
      {tab === 'auditoria' && <AuditTab />}
    </>
  );
}

// ─── Organização ─────────────────────────────────────────
interface Organization {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  timezone: string;
  settings: Record<string, unknown>;
}

function OrganizationTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', document: '', timezone: '', brandName: '', supportEmail: '', offlineThresholdHours: '24' });
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ organization: Organization }>('/settings'),
  });

  useEffect(() => {
    if (!data?.organization) return;
    const settings = data.organization.settings ?? {};
    setForm({
      name: data.organization.name,
      document: data.organization.document ?? '',
      timezone: data.organization.timezone,
      brandName: String(settings.brandName ?? ''),
      supportEmail: String(settings.supportEmail ?? ''),
      offlineThresholdHours: String(settings.offlineThresholdHours ?? 24),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          name: form.name,
          document: form.document,
          timezone: form.timezone,
          settings: {
            brandName: form.brandName,
            supportEmail: form.supportEmail,
            offlineThresholdHours: Number(form.offlineThresholdHours) || 24,
          },
        },
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Dados da organização</h2>
      <p className="mt-1 text-sm text-slate-500">
        Informações exibidas no sistema e usadas nos cabeçalhos dos relatórios.
      </p>

      {saved && (
        <div className="mt-4">
          <Alert tone="success">Configurações salvas.</Alert>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Nome da organização">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!can('ADMIN')} />
        </Field>
        <Field label="CNPJ">
          <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} disabled={!can('ADMIN')} />
        </Field>
        <Field label="Fuso horário">
          <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} disabled={!can('ADMIN')}>
            <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
            <option value="America/Manaus">America/Manaus</option>
            <option value="America/Cuiaba">America/Cuiaba</option>
            <option value="America/Belem">America/Belem</option>
            <option value="America/Rio_Branco">America/Rio_Branco</option>
            <option value="UTC">UTC</option>
          </Select>
        </Field>
        <Field label="E-mail de suporte">
          <Input
            type="email"
            value={form.supportEmail}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
            disabled={!can('ADMIN')}
          />
        </Field>
        <Field
          label="Horas sem transmissão para alerta"
          hint="Usado para classificar veículos como “sem comunicação”."
        >
          <Input
            type="number"
            min={1}
            max={720}
            value={form.offlineThresholdHours}
            onChange={(e) => setForm({ ...form, offlineThresholdHours: e.target.value })}
            disabled={!can('ADMIN')}
          />
        </Field>
      </div>

      {can('ADMIN') && (
        <div className="mt-5">
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Integração Track7 ───────────────────────────────────
interface IntegrationView {
  configured: boolean;
  region: string;
  identityUrl: string;
  apiUrl: string;
  scope: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  organisationId: number | null;
  groupIds: number[];
  syncEnabled: boolean;
  syncCron: string;
  historyDays: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

interface RegionPreset {
  key: string;
  label: string;
  identityUrl: string;
  apiUrl: string;
}

const CRON_PRESETS: Array<{ value: string; label: string }> = [
  { value: '*/15 * * * *', label: 'A cada 15 minutos' },
  { value: '0 * * * *', label: 'A cada hora' },
  { value: '0 */6 * * *', label: 'A cada 6 horas' },
  { value: '0 */12 * * *', label: 'A cada 12 horas' },
  { value: '0 3 * * *', label: 'Diário (24h)' },
];

function IntegrationTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = can('ADMIN', 'MANAGER');

  const [form, setForm] = useState({
    region: 'us',
    identityUrl: '',
    apiUrl: '',
    clientId: '',
    clientSecret: '',
    username: '',
    password: '',
    organisationId: '',
    syncEnabled: true,
    syncCron: '0 */6 * * *',
    historyDays: '7',
  });
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['integration-track7'],
    queryFn: () => api<{ integration: IntegrationView; regions: RegionPreset[] }>('/integrations/track7'),
    refetchInterval: (query) =>
      (query.state.data as { integration: IntegrationView } | undefined)?.integration.lastSyncStatus === 'RUNNING'
        ? 5000
        : false,
  });

  useEffect(() => {
    if (!data?.integration) return;
    const i = data.integration;
    setForm((prev) => ({
      ...prev,
      region: i.region,
      identityUrl: i.identityUrl,
      apiUrl: i.apiUrl,
      organisationId: i.organisationId ? String(i.organisationId) : '',
      syncEnabled: i.syncEnabled,
      syncCron: i.syncCron,
      historyDays: String(i.historyDays),
    }));
  }, [data]);

  const payload = () => ({
    region: form.region,
    identityUrl: form.identityUrl || undefined,
    apiUrl: form.apiUrl || undefined,
    clientId: form.clientId || undefined,
    clientSecret: form.clientSecret || undefined,
    username: form.username || undefined,
    password: form.password || undefined,
    organisationId: form.organisationId ? Number(form.organisationId) : null,
    syncEnabled: form.syncEnabled,
    syncCron: form.syncCron,
    historyDays: Number(form.historyDays) || 7,
  });

  const save = useMutation({
    mutationFn: () => api('/integrations/track7', { method: 'PUT', body: payload() }),
    onSuccess: () => {
      setForm((prev) => ({ ...prev, clientId: '', clientSecret: '', username: '', password: '' }));
      setFeedback({ tone: 'success', message: 'Credenciais salvas com segurança (cifradas no banco).' });
      void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
    },
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; latencyMs: number; message: string; organisations: Array<{ groupId: number; name: string }> }>(
        '/integrations/track7/test',
        { method: 'POST', body: payload() },
      ),
    onSuccess: (result) =>
      setFeedback({
        tone: 'success',
        message: `${result.message} (${result.latencyMs} ms) — ${result.organisations
          .map((o) => `${o.name} #${o.groupId}`)
          .join(', ')}`,
      }),
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  const sync = useMutation({
    mutationFn: (kind: 'catalog' | 'incremental' | 'history') =>
      api<{ accepted?: boolean }>('/integrations/track7/sync', { method: 'POST', body: { kind } }),
    onSuccess: () => {
      setFeedback({ tone: 'info', message: 'Sincronização iniciada. Acompanhe pelo histórico.' });
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
        void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      }, 4000);
    },
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  if (isLoading) return <Spinner />;
  const integration = data!.integration;

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Plug className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-slate-900">Track7 (MiX Telematics)</h2>
          {integration.configured ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
              Credenciais cadastradas
            </Badge>
          ) : (
            <Badge tone="warning" icon={<XCircle className="h-3.5 w-3.5" />}>
              Credenciais pendentes
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-4xl text-sm text-slate-500">
          Sincroniza veículos, motoristas, posições, viagens e eventos da Track7. As credenciais são guardadas
          cifradas (AES-256-GCM) e nunca retornam para a tela — os campos aparecem vazios por segurança,
          preencha apenas para trocar.
        </p>

        {feedback && (
          <div className="mt-4">
            <Alert tone={feedback.tone}>{feedback.message}</Alert>
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Região da plataforma">
            <Select
              value={form.region}
              disabled={!editable}
              onChange={(e) => {
                const preset = data!.regions.find((r) => r.key === e.target.value);
                setForm({
                  ...form,
                  region: e.target.value,
                  identityUrl: preset?.identityUrl ?? form.identityUrl,
                  apiUrl: preset?.apiUrl ?? form.apiUrl,
                });
              }}
            >
              {data!.regions.map((region) => (
                <option key={region.key} value={region.key}>
                  {region.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ID da organização na Track7" hint="Deixe vazio para descoberta automática.">
            <Input
              value={form.organisationId}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, organisationId: e.target.value })}
              placeholder="ex.: 100"
            />
          </Field>

          <Field label="Client ID">
            <Input
              value={form.clientId}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              placeholder={integration.hasClientId ? '•••• (preencha para trocar)' : 'informe o Client ID'}
              autoComplete="off"
            />
          </Field>
          <Field label="Client Secret">
            <Input
              type="password"
              value={form.clientSecret}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder={integration.hasClientSecret ? '•••• (preencha para trocar)' : 'informe o Client Secret'}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Usuário">
            <Input
              value={form.username}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={integration.hasUsername ? '•••• (preencha para trocar)' : 'usuário do MiX Fleet Manager'}
              autoComplete="off"
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              value={form.password}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={integration.hasPassword ? '•••• (preencha para trocar)' : 'senha do MiX Fleet Manager'}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Identity Server (token)" hint="Preenchido pela região; ajuste apenas se orientado pela Track7.">
            <Input value={form.identityUrl} disabled={!editable} onChange={(e) => setForm({ ...form, identityUrl: e.target.value })} />
          </Field>
          <Field label="URL da API">
            <Input value={form.apiUrl} disabled={!editable} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-6">
          <Toggle
            checked={form.syncEnabled}
            disabled={!editable}
            onChange={(value) => setForm({ ...form, syncEnabled: value })}
            label="Sincronização automática"
          />
          <Field label="Intervalo" className="w-56">
            <Select value={form.syncCron} disabled={!editable} onChange={(e) => setForm({ ...form, syncCron: e.target.value })}>
              {CRON_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              {!CRON_PRESETS.some((p) => p.value === form.syncCron) && (
                <option value={form.syncCron}>{form.syncCron} (personalizado)</option>
              )}
            </Select>
          </Field>
          <Field label="Dias de histórico" className="w-40" >
            <Input
              type="number"
              min={1}
              max={90}
              disabled={!editable}
              value={form.historyDays}
              onChange={(e) => setForm({ ...form, historyDays: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!editable} onClick={() => save.mutate()}>
            Salvar
          </Button>
          <Button icon={<Plug className="h-4 w-4" />} loading={test.isPending} disabled={!editable} onClick={() => test.mutate()}>
            Testar conexão
          </Button>
          <Button
            icon={<RefreshCw className="h-4 w-4" />}
            loading={sync.isPending}
            disabled={!integration.configured}
            onClick={() => sync.mutate('incremental')}
          >
            Sincronizar agora
          </Button>
          <Button icon={<Stethoscope className="h-4 w-4" />} disabled={!editable} onClick={() => setShowDiagnostics(true)}>
            Diagnóstico
          </Button>
          <Button icon={<Network className="h-4 w-4" />} onClick={() => setShowGroups(true)}>
            Grupos
          </Button>
          <Button icon={<History className="h-4 w-4" />} onClick={() => setShowHistory(true)}>
            Histórico
          </Button>
        </div>

        <div className="mt-6 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Última sincronização</p>
            <p className="mt-1 text-slate-800">{formatDateTime(integration.lastSyncAt)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</p>
            <p className="mt-1">
              {integration.lastSyncStatus ? (
                <Badge tone={integration.lastSyncStatus === 'SUCCESS' ? 'success' : integration.lastSyncStatus === 'PARTIAL' ? 'warning' : 'danger'}>
                  {integration.lastSyncStatus === 'SUCCESS' ? 'Sucesso' : integration.lastSyncStatus}
                </Badge>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Erro</p>
            <p className="mt-1 break-words text-red-600">{integration.lastSyncError ?? '—'}</p>
          </div>
        </div>
      </Card>

      <DiagnosticsModal open={showDiagnostics} onClose={() => setShowDiagnostics(false)} />
      <GroupsModal open={showGroups} onClose={() => setShowGroups(false)} />
      <SyncHistoryModal open={showHistory} onClose={() => setShowHistory(false)} />
    </>
  );
}

function DiagnosticsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['track7-diagnostics'],
    queryFn: () =>
      api<{ checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; detail: string }> }>(
        '/integrations/track7/diagnostics',
      ),
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Diagnóstico da integração"
      subtitle="Verificação ponta a ponta: credenciais, autenticação e dados."
      footer={
        <>
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={isFetching} onClick={() => void refetch()}>
            Reexecutar
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <Alert tone="danger">{(error as Error).message}</Alert>
      ) : (
        <ul className="space-y-3">
          {data?.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              {check.status === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              ) : check.status === 'warn' ? (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              )}
              <div>
                <p className="text-sm font-medium text-slate-800">{check.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function GroupsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['track7-groups'],
    queryFn: () =>
      api<{ groups: Array<{ group_id: number; name: string; level: number; group_type_name: string | null; is_organisation: boolean }> }>(
        '/integrations/track7/groups',
      ),
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Grupos e sites da Track7"
      subtitle="Hierarquia sincronizada da organização."
      footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}
    >
      {isLoading ? (
        <Spinner />
      ) : !data?.groups.length ? (
        <EmptyState title="Nenhum grupo sincronizado" description="Execute uma sincronização para carregar a hierarquia." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.groups.map((group) => (
            <li key={group.group_id} className="flex items-center justify-between py-2" style={{ paddingLeft: group.level * 16 }}>
              <div>
                <p className="text-sm font-medium text-slate-800">{group.name}</p>
                <p className="text-xs text-slate-400">
                  #{group.group_id}
                  {group.group_type_name ? ` · ${group.group_type_name}` : ''}
                </p>
              </div>
              {group.is_organisation && <Badge tone="info">Organização</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function SyncHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['track7-sync-runs'],
    queryFn: () =>
      api<{
        runs: Array<{
          id: string;
          kind: string;
          status: string;
          trigger_source: string;
          started_at: string;
          duration_ms: number | null;
          stats: Record<string, number>;
          error: string | null;
          created_by_name: string | null;
        }>;
      }>('/integrations/track7/sync-runs'),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Histórico de sincronizações"
      footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}
    >
      {isLoading ? (
        <Spinner />
      ) : !data?.runs.length ? (
        <EmptyState title="Nenhuma sincronização executada" />
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Início</Th>
              <Th>Tipo</Th>
              <Th>Origem</Th>
              <Th>Status</Th>
              <Th>Duração</Th>
              <Th>Resultados</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.runs.map((run) => (
              <tr key={run.id}>
                <Td>{formatDateTime(run.started_at)}</Td>
                <Td>{run.kind}</Td>
                <Td>{run.trigger_source}{run.created_by_name ? ` · ${run.created_by_name}` : ''}</Td>
                <Td>
                  <Badge tone={run.status === 'SUCCESS' ? 'success' : run.status === 'RUNNING' ? 'info' : run.status === 'PARTIAL' ? 'warning' : 'danger'}>
                    {run.status}
                  </Badge>
                </Td>
                <Td>{run.duration_ms ? `${formatNumber(run.duration_ms / 1000, 1)}s` : '—'}</Td>
                <Td className="max-w-[320px] whitespace-normal text-xs text-slate-500">
                  {run.error
                    ? run.error
                    : Object.entries(run.stats ?? {})
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(' · ') || '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}

// ─── Auditoria ───────────────────────────────────────────
function AuditTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<{
        logs: Array<{
          id: number;
          action: string;
          entity: string | null;
          created_at: string;
          ip: string | null;
          user_name: string | null;
          user_email: string | null;
        }>;
      }>('/settings/audit'),
  });

  if (isLoading) return <Spinner />;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Trilha de auditoria</h2>
        <p className="mt-0.5 text-xs text-slate-500">Registro das ações realizadas no sistema.</p>
      </div>
      {!data?.logs.length ? (
        <EmptyState title="Sem registros" />
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Data</Th>
              <Th>Ação</Th>
              <Th>Entidade</Th>
              <Th>Usuário</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.logs.map((log) => (
              <tr key={log.id}>
                <Td>{formatDateTime(log.created_at)}</Td>
                <Td className="font-mono text-xs">{log.action}</Td>
                <Td>{log.entity ?? '—'}</Td>
                <Td>{log.user_name ?? '—'}</Td>
                <Td className="font-mono text-xs">{log.ip ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
