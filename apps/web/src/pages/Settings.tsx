import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  History,
  Network,
  Plug,
  RefreshCw,
  Radio,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  ScrollText,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  streamEnabled: boolean;
  streamIntervalSeconds: number;
  streamQuantity: number;
  credentialScope: 'OPERATOR' | 'ORGANIZATION';
  shared: boolean;
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

/** Tipos de grupo devolvidos pela API (enum em inglês) → rótulo em português. */
const GROUP_TYPE_LABELS: Record<string, string> = {
  DataCentre: 'Data center',
  RsoGroup: 'Grupo RSO',
  DealerGroup: 'Revenda',
  MultiLevelOrg: 'Organização multinível',
  OrganisationGroup: 'Organização',
  OrganisationSubGroup: 'Subgrupo',
  SiteGroup: 'Site',
  DefaultSite: 'Site padrão',
  SecurityGroup: 'Grupo de segurança',
  NotificationGroup: 'Grupo de notificação',
  MobileDeviceAdminCommissioningGroup: 'Comissionamento',
  DriverUserGroup: 'Grupo de motoristas',
};

/** Presets usados antes de a API responder (visão consolidada). */
const DEFAULT_REGIONS: RegionPreset[] = [
  {
    key: 'us',
    label: 'Américas (US)',
    identityUrl: 'https://identity.us.mixtelematics.com/core',
    apiUrl: 'https://integrate.us.mixtelematics.com',
  },
];

const CRON_PRESETS: Array<{ value: string; label: string }> = [
  { value: '*/15 * * * *', label: 'A cada 15 minutos' },
  { value: '0 * * * *', label: 'A cada hora' },
  { value: '0 */6 * * *', label: 'A cada 6 horas' },
  { value: '0 */12 * * *', label: 'A cada 12 horas' },
  { value: '0 3 * * *', label: 'Diário (24h)' },
];

function IntegrationTab() {
  const { can } = useAuth();
  const { operatorId, operator, operators } = useOperator();
  const queryClient = useQueryClient();
  const editable = can('ADMIN', 'MANAGER');
  const scope = { operatorId: operatorId ?? undefined };

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
    streamEnabled: true,
    streamIntervalSeconds: '30',
  });
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const needsOperator = !operatorId && operators.length > 1;

  const { data, isLoading } = useQuery({
    queryKey: ['integration-track7', operatorId],
    queryFn: () =>
      api<{ mode: 'POR_OPERADORA' | 'CONSORCIO'; integration: IntegrationView; regions: RegionPreset[] }>(
        '/integrations/track7',
        { query: scope },
      ),
    enabled: !needsOperator,
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
      streamEnabled: i.streamEnabled,
      streamIntervalSeconds: String(i.streamIntervalSeconds),
    }));
  }, [data]);

  const payload = () => ({
    operatorId: operatorId ?? undefined,
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
    streamEnabled: form.streamEnabled,
    streamIntervalSeconds: Number(form.streamIntervalSeconds) || 30,
  });

  const save = useMutation({
    mutationFn: () => api('/integrations/track7', { method: 'PUT', body: payload() }),
    onSuccess: () => {
      setForm((prev) => ({ ...prev, clientId: '', clientSecret: '', username: '', password: '' }));
      setFeedback({ tone: 'success', message: 'Credenciais salvas com segurança (cifradas no banco).' });
      void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
      void queryClient.invalidateQueries({ queryKey: ['operators'] });
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
      api<{ accepted?: boolean }>('/integrations/track7/sync', {
        method: 'POST',
        body: { kind, operatorId: operatorId ?? undefined },
      }),
    onSuccess: () => {
      setFeedback({ tone: 'info', message: 'Sincronização iniciada. Acompanhe pelo histórico.' });
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
        void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      }, 4000);
    },
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  // Sem operadora escolhida só faz sentido mostrar o acesso da conta —
  // as credenciais próprias são individuais.
  if (needsOperator) {
    return (
      <>
        <IntegrationModeCard />
        <SharedCredentialCard editable={editable} regions={DEFAULT_REGIONS} />
        <div className="mt-4">
          <Alert tone="info" title="Escolha uma empresa operadora">
            Para ver ou cadastrar credenciais próprias e acompanhar o coletor, selecione a operadora no
            seletor do topo da barra lateral.
          </Alert>
        </div>
      </>
    );
  }

  if (isLoading || !data) return <Spinner />;
  const integration = data.integration;
  const consortium = data.mode === 'CONSORCIO';
  const canEditOwn = editable && !consortium;

  return (
    <>
      <IntegrationModeCard />
      <SharedCredentialCard editable={editable} regions={data.regions} />

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Plug className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-slate-900">
            Credenciais desta operadora
          </h2>
          {integration.shared ? (
            <Badge tone="info" icon={<Share2 className="h-3.5 w-3.5" />}>
              Usando o acesso da conta
            </Badge>
          ) : integration.configured ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
              Credenciais próprias
            </Badge>
          ) : (
            <Badge tone="warning" icon={<XCircle className="h-3.5 w-3.5" />}>
              Credenciais pendentes
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-4xl text-sm text-slate-500">
          {integration.shared
            ? 'Esta operadora está sendo atendida pelo acesso único da conta. Preencha os campos abaixo apenas se ela tiver chaves próprias — elas passam a ter precedência.'
            : 'Sincroniza veículos, motoristas, posições, viagens e eventos da Track7. As credenciais são guardadas cifradas (AES-256-GCM) e nunca retornam para a tela — os campos aparecem vazios por segurança, preencha apenas para trocar.'}
        </p>

        {consortium && (
          <div className="mt-4">
            <Alert tone="info" title="Credenciais gerenciadas pelo acesso da conta">
              A conta está em modo consórcio, então esta empresa usa o acesso único e os campos abaixo ficam
              desativados. Para cadastrar chaves próprias, desligue o modo no topo da página.
            </Alert>
          </div>
        )}

        {!operatorId && operators.length > 1 && (
          <div className="mt-4">
            <Alert tone="warning" title="Selecione a empresa operadora">
              As credenciais são individuais por operadora. Escolha uma no seletor do topo para configurar.
            </Alert>
          </div>
        )}

        {operator && operators.length > 1 && (
          <div className="mt-4">
            <Alert tone="info">
              Configurando <strong>{operator.name}</strong>.
            </Alert>
          </div>
        )}

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
              disabled={!canEditOwn}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={integration.hasUsername ? '•••• (preencha para trocar)' : 'usuário do MiX Fleet Manager'}
              autoComplete="off"
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              value={form.password}
              disabled={!canEditOwn}
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
          <Button
            variant="primary"
            icon={<Save className="h-4 w-4" />}
            loading={save.isPending}
            disabled={!canEditOwn}
            onClick={() => save.mutate()}
          >
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

      <PositionStreamCard
        editable={editable}
        enabled={form.streamEnabled}
        intervalSeconds={form.streamIntervalSeconds}
        onChange={(patch) => setForm({ ...form, ...patch })}
        configured={integration.configured}
        operatorId={operatorId}
      />

      <DiagnosticsModal
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        operatorId={operatorId}
      />
      <GroupsModal open={showGroups} onClose={() => setShowGroups(false)} operatorId={operatorId} />
      <SyncHistoryModal open={showHistory} onClose={() => setShowHistory(false)} operatorId={operatorId} />
    </>
  );
}

interface IntegrationModeState {
  mode: 'POR_OPERADORA' | 'CONSORCIO';
  changedAt: string | null;
  changedByName: string | null;
  canEnableConsortium: boolean;
  blockers: string[];
  sharedConfigured: boolean;
  operatorsWithOwnCredentials: number;
}

/**
 * Interruptor no nível da conta. No modo consórcio o sistema para de pedir
 * credencial empresa por empresa e passa a derivar tudo de um acesso só.
 */
function IntegrationModeCard() {
  const { can } = useAuth();
  const { refresh } = useOperator();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<'POR_OPERADORA' | 'CONSORCIO' | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['integration-mode'],
    queryFn: () => api<IntegrationModeState>('/integrations/track7/mode'),
  });

  const change = useMutation({
    mutationFn: (mode: 'POR_OPERADORA' | 'CONSORCIO') =>
      api<{ mode: string; organisationsVisible: number | null }>('/integrations/track7/mode', {
        method: 'PUT',
        body: { mode },
      }),
    onSuccess: (result) => {
      setFeedback({
        tone: 'success',
        message:
          result.mode === 'CONSORCIO'
            ? `Modo consórcio ligado. O acesso da conta enxerga ${result.organisationsVisible} organização(ões).`
            : 'Modo voltou para credenciais por operadora.',
      });
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ['integration-mode'] });
      void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
      refresh();
    },
    onError: (err: Error) => {
      setFeedback({ tone: 'danger', message: err.message });
      setConfirming(null);
    },
  });

  if (isLoading || !data) return null;
  const consortium = data.mode === 'CONSORCIO';

  return (
    <>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <SlidersHorizontal className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-slate-900">Modo de integração</h2>
          <Badge tone={consortium ? 'info' : 'neutral'}>
            {consortium ? 'Consórcio · acesso único' : 'Por operadora'}
          </Badge>
        </div>

        <p className="mt-2 max-w-4xl text-sm text-slate-500">
          {consortium
            ? 'A conta usa um único acesso da Track7. As empresas são derivadas das organizações que esse acesso enxerga, e as credenciais individuais ficam desativadas.'
            : 'Cada empresa cadastra as próprias credenciais da Track7. Ligue o modo consórcio se a Track7 emitir um acesso único que enxergue todas as empresas.'}
        </p>

        {feedback && (
          <div className="mt-4">
            <Alert tone={feedback.tone}>{feedback.message}</Alert>
          </div>
        )}

        {!consortium && data.blockers.length > 0 && (
          <div className="mt-4">
            <Alert tone="info" title="Para ligar o modo consórcio">
              <ul className="list-disc space-y-1 pl-5">
                {data.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4">
          {can('ADMIN') ? (
            <Toggle
              checked={consortium}
              disabled={!consortium && !data.canEnableConsortium}
              onChange={(value) => setConfirming(value ? 'CONSORCIO' : 'POR_OPERADORA')}
              label="Usar um acesso único para todas as empresas"
            />
          ) : (
            <p className="text-sm text-slate-500">Somente administradores podem alterar o modo.</p>
          )}
          {data.changedAt && (
            <span className="text-xs text-slate-400">
              Alterado em {formatDateTime(data.changedAt)}
              {data.changedByName ? ` por ${data.changedByName}` : ''}
            </span>
          )}
        </div>
      </Card>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === 'CONSORCIO' ? 'Ligar o modo consórcio?' : 'Voltar para credenciais por operadora?'}
        footer={
          <>
            <Button onClick={() => setConfirming(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={change.isPending}
              onClick={() => confirming && change.mutate(confirming)}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {confirming === 'CONSORCIO' ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>A partir de agora todas as empresas passam a usar o acesso único da conta.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>O sistema deixa de pedir credenciais empresa por empresa.</li>
              <li>A lista de empresas passa a ser mantida pela API automaticamente.</li>
              {data.operatorsWithOwnCredentials > 0 && (
                <li>
                  <strong>{data.operatorsWithOwnCredentials}</strong> operadora(s) têm chaves próprias — elas
                  ficam <strong>guardadas mas ignoradas</strong>, e voltam a valer se você desligar o modo.
                </li>
              )}
            </ul>
            <p className="text-xs text-slate-500">
              A troca só é aceita se o acesso da conta realmente autenticar na Track7.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Cada empresa volta a depender das próprias credenciais.</p>
            <Alert tone="warning">
              Operadoras sem chaves próprias vão parar de sincronizar até que alguém as cadastre.
            </Alert>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * Acesso único da conta: uma credencial que atende todas as operadoras sem
 * chaves próprias. É o modo indicado quando a Track7 emite um acesso de
 * consórcio que enxerga várias organizações.
 */
function SharedCredentialCard({ editable, regions }: { editable: boolean; regions: RegionPreset[] }) {
  const queryClient = useQueryClient();
  const { refresh } = useOperator();
  const [open, setOpen] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const [form, setForm] = useState({
    region: 'us',
    identityUrl: '',
    apiUrl: '',
    clientId: '',
    clientSecret: '',
    username: '',
    password: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['integration-track7-shared'],
    queryFn: () => api<{ integration: IntegrationView }>('/integrations/track7/shared'),
  });

  useEffect(() => {
    if (!data?.integration) return;
    setForm((prev) => ({
      ...prev,
      region: data.integration.region,
      identityUrl: data.integration.identityUrl,
      apiUrl: data.integration.apiUrl,
    }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/integrations/track7/shared', {
        method: 'PUT',
        body: {
          region: form.region,
          identityUrl: form.identityUrl || undefined,
          apiUrl: form.apiUrl || undefined,
          clientId: form.clientId || undefined,
          clientSecret: form.clientSecret || undefined,
          username: form.username || undefined,
          password: form.password || undefined,
        },
      }),
    onSuccess: () => {
      setForm((prev) => ({ ...prev, clientId: '', clientSecret: '', username: '', password: '' }));
      setFeedback({ tone: 'success', message: 'Acesso da conta salvo. Agora descubra as operadoras.' });
      void queryClient.invalidateQueries({ queryKey: ['integration-track7-shared'] });
      void queryClient.invalidateQueries({ queryKey: ['integration-track7'] });
    },
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  if (isLoading) return null;
  const shared = data!.integration;

  return (
    <>
      <Card className="p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
        >
          <Share2 className="h-5 w-5 text-brand-600" />
          <h2 className="flex-1 text-base font-semibold text-slate-900">Acesso único da conta</h2>
          {shared.configured ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
              Configurado
            </Badge>
          ) : (
            <Badge tone="neutral">Não configurado</Badge>
          )}
          <ChevronDownIcon open={open} />
        </button>

        <p className="mt-2 max-w-4xl text-sm text-slate-500">
          Uma credencial só, válida para todas as operadoras que não tiverem chaves próprias. Use quando a
          Track7 fornecer um acesso de consórcio — o sistema lista as organizações que ele enxerga e cria as
          empresas automaticamente.
        </p>

        {open && (
          <>
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
                    const preset = regions.find((r) => r.key === e.target.value);
                    setForm({
                      ...form,
                      region: e.target.value,
                      identityUrl: preset?.identityUrl ?? form.identityUrl,
                      apiUrl: preset?.apiUrl ?? form.apiUrl,
                    });
                  }}
                >
                  {regions.map((region) => (
                    <option key={region.key} value={region.key}>
                      {region.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="URL da API">
                <Input
                  value={form.apiUrl}
                  disabled={!editable}
                  onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                />
              </Field>
              <Field label="Client ID">
                <Input
                  value={form.clientId}
                  disabled={!editable}
                  autoComplete="off"
                  placeholder={shared.hasClientId ? '•••• (preencha para trocar)' : 'informe o Client ID'}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                />
              </Field>
              <Field label="Client Secret">
                <Input
                  type="password"
                  value={form.clientSecret}
                  disabled={!editable}
                  autoComplete="new-password"
                  placeholder={shared.hasClientSecret ? '•••• (preencha para trocar)' : 'informe o Client Secret'}
                  onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                />
              </Field>
              <Field label="Usuário">
                <Input
                  value={form.username}
                  disabled={!editable}
                  autoComplete="off"
                  placeholder={shared.hasUsername ? '•••• (preencha para trocar)' : 'usuário do consórcio'}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
              <Field label="Senha">
                <Input
                  type="password"
                  value={form.password}
                  disabled={!editable}
                  autoComplete="new-password"
                  placeholder={shared.hasPassword ? '•••• (preencha para trocar)' : 'senha do consórcio'}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<Save className="h-4 w-4" />}
                loading={save.isPending}
                disabled={!editable}
                onClick={() => save.mutate()}
              >
                Salvar acesso da conta
              </Button>
              <Button
                icon={<Search className="h-4 w-4" />}
                disabled={!shared.configured}
                onClick={() => setShowDiscovery(true)}
              >
                Descobrir operadoras
              </Button>
            </div>
          </>
        )}
      </Card>

      <DiscoveryModal
        open={showDiscovery}
        onClose={() => setShowDiscovery(false)}
        onApplied={() => {
          refresh();
          void queryClient.invalidateQueries({ queryKey: ['operators'] });
        }}
      />
    </>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface DiscoveredOrganisation {
  groupId: number;
  name: string;
  status: 'linked' | 'new' | 'conflict';
  operatorId: string | null;
  operatorName: string | null;
}

/** Lista as organizações visíveis e permite criar as operadoras em lote. */
function DiscoveryModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [result, setResult] = useState<{ organisations: DiscoveredOrganisation[]; created: number; linked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['track7-discovery'],
    queryFn: () =>
      api<{ organisations: DiscoveredOrganisation[]; created: number; linked: number }>(
        '/integrations/track7/discover',
        { method: 'POST', body: { apply: false } },
      ),
    enabled: open,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: () =>
      api<{ organisations: DiscoveredOrganisation[]; created: number; linked: number }>(
        '/integrations/track7/discover',
        { method: 'POST', body: { apply: true } },
      ),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      onApplied();
    },
    onError: (err: Error) => setError(err.message),
  });

  const data = result ?? preview.data;
  const pending = data?.organisations.filter((o) => o.status === 'new').length ?? 0;

  const tone = (status: DiscoveredOrganisation['status']) =>
    status === 'linked' ? 'success' : status === 'new' ? 'info' : 'warning';
  const label = (status: DiscoveredOrganisation['status']) =>
    status === 'linked' ? 'Vinculada' : status === 'new' ? 'Nova' : 'Conflito de nome';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Operadoras visíveis na Track7"
      subtitle="Cada organização que a credencial enxerga vira uma empresa operadora."
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button
            variant="primary"
            loading={apply.isPending}
            disabled={pending === 0}
            onClick={() => apply.mutate()}
          >
            {pending > 0 ? `Criar ${pending} operadora(s)` : 'Nada a criar'}
          </Button>
        </>
      }
    >
      {preview.isLoading ? (
        <Spinner />
      ) : preview.error && !data ? (
        <Alert tone="danger">{(preview.error as Error).message}</Alert>
      ) : (
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          {result && (
            <Alert tone="success">
              {result.created} operadora(s) criada(s) e {result.linked} vinculada(s).
            </Alert>
          )}
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Organização na Track7</Th>
                <Th>ID</Th>
                <Th>Situação</Th>
                <Th>Operadora</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.organisations.map((item) => (
                <tr key={item.groupId}>
                  <Td className="font-medium text-slate-800">{item.name}</Td>
                  <Td className="font-mono text-xs">#{item.groupId}</Td>
                  <Td>
                    <Badge tone={tone(item.status)}>{label(item.status)}</Badge>
                  </Td>
                  <Td>{item.operatorName ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-slate-500">
            "Conflito de nome" significa que já existe uma operadora com esse nome vinculada a outra
            organização — resolva manualmente em Operadoras.
          </p>
        </div>
      )}
    </Modal>
  );
}

interface StreamStatus {
  cursor: {
    since_token: string | null;
    last_run_at: string | null;
    last_count: number;
    total_collected: number;
    consecutive_errors: number;
    last_error: string | null;
    last_gap_from: string | null;
    last_gap_to: string | null;
  } | null;
  stats: { total: number; ultimas_24h: number; ultima: string | null; veiculos: number };
}

/**
 * Coletor contínuo de posições — é ele que constrói o histórico de GPS
 * exigido no relatório georreferenciado da SMMUR/SUMOB.
 */
function PositionStreamCard({
  editable,
  enabled,
  intervalSeconds,
  onChange,
  configured,
  operatorId,
}: {
  editable: boolean;
  enabled: boolean;
  intervalSeconds: string;
  onChange: (patch: { streamEnabled?: boolean; streamIntervalSeconds?: string }) => void;
  configured: boolean;
  operatorId: string | null;
}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['track7-stream', operatorId],
    queryFn: () =>
      api<StreamStatus>('/integrations/track7/stream', { query: { operatorId: operatorId ?? undefined } }),
    refetchInterval: 15_000,
  });

  const collect = useMutation({
    mutationFn: () =>
      api<{ collected: number; pages: number; durationMs: number }>('/integrations/track7/stream/collect', {
        method: 'POST',
        body: { operatorId: operatorId ?? undefined },
      }),
    onSuccess: (result) => {
      setFeedback(`${result.collected} posição(ões) em ${result.pages} página(s) · ${result.durationMs} ms`);
      void queryClient.invalidateQueries({ queryKey: ['track7-stream'] });
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const cursor = status.data?.cursor;
  const stats = status.data?.stats;
  const hasGap = Boolean(cursor?.last_gap_from);

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Radio className="h-5 w-5 text-brand-600" />
        <h2 className="text-base font-semibold text-slate-900">Coletor de posições (tempo real)</h2>
        {cursor?.consecutive_errors ? (
          <Badge tone="danger">{cursor.consecutive_errors} falha(s) seguida(s)</Badge>
        ) : cursor?.since_token ? (
          <Badge tone="success">Em operação</Badge>
        ) : (
          <Badge tone="neutral">Nunca executado</Badge>
        )}
      </div>
      <p className="mt-2 max-w-4xl text-sm text-slate-500">
        Lê continuamente o fluxo <code>positions/createdsince</code> da Track7 e grava cada ping no banco.
        É este histórico que alimenta o relatório georreferenciado de viagens — sem ele não há
        latitude e longitude para comprovar o itinerário.
      </p>

      {hasGap && (
        <div className="mt-4">
          <Alert tone="warning" title="Lacuna no histórico">
            O coletor ficou parado além do limite de 7 dias do ponteiro. Use o backfill por período para
            preencher o intervalo de {formatDateTime(cursor?.last_gap_from)} a {formatDateTime(cursor?.last_gap_to)}.
          </Alert>
        </div>
      )}

      {feedback && (
        <div className="mt-4">
          <Alert tone="info">{feedback}</Alert>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-6">
        <Toggle
          checked={enabled}
          disabled={!editable}
          onChange={(value) => onChange({ streamEnabled: value })}
          label="Coleta contínua ativa"
        />
        <Field label="Intervalo (segundos)" className="w-44" hint="30 s é o padrão da plataforma.">
          <Input
            type="number"
            min={10}
            max={3600}
            disabled={!editable}
            value={intervalSeconds}
            onChange={(e) => onChange({ streamIntervalSeconds: e.target.value })}
          />
        </Field>
        <Button
          icon={<Radio className="h-4 w-4" />}
          loading={collect.isPending}
          disabled={!configured}
          onClick={() => collect.mutate()}
        >
          Coletar agora
        </Button>
      </div>

      <div className="mt-6 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Última coleta</p>
          <p className="mt-1 text-slate-800">{formatDateTime(cursor?.last_run_at)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Posições (24 h)</p>
          <p className="mt-1 text-slate-800">{formatNumber(stats?.ultimas_24h)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Veículos transmitindo</p>
          <p className="mt-1 text-slate-800">{formatNumber(stats?.veiculos)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Ponteiro do fluxo</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-600">{cursor?.since_token ?? '—'}</p>
        </div>
      </div>

      {cursor?.last_error && (
        <p className="mt-3 break-words text-sm text-red-600">{cursor.last_error}</p>
      )}
    </Card>
  );
}

function DiagnosticsModal({
  open,
  onClose,
  operatorId,
}: {
  open: boolean;
  onClose: () => void;
  operatorId: string | null;
}) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['track7-diagnostics', operatorId],
    queryFn: () =>
      api<{ checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; detail: string }> }>(
        '/integrations/track7/diagnostics',
        { query: { operatorId: operatorId ?? undefined } },
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

function GroupsModal({
  open,
  onClose,
  operatorId,
}: {
  open: boolean;
  onClose: () => void;
  operatorId: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['track7-groups', operatorId],
    queryFn: () =>
      api<{ groups: Array<{ group_id: number; name: string; level: number; group_type_name: string | null; is_organisation: boolean }> }>(
        '/integrations/track7/groups',
        { query: { operatorId: operatorId ?? undefined } },
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
                  {group.group_type_name
                    ? ` · ${GROUP_TYPE_LABELS[group.group_type_name] ?? group.group_type_name}`
                    : ''}
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

function SyncHistoryModal({
  open,
  onClose,
  operatorId,
}: {
  open: boolean;
  onClose: () => void;
  operatorId: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['track7-sync-runs', operatorId],
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
          operator_name: string | null;
        }>;
      }>('/integrations/track7/sync-runs', { query: { operatorId: operatorId ?? undefined } }),
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
              <Th>Empresa</Th>
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
                <Td>{run.operator_name ?? '—'}</Td>
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
