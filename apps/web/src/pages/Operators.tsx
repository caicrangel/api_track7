import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOperator, type Operator } from '../lib/operator';
import { formatDateTime, formatNumber, timeAgo } from '../lib/format';
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
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

/**
 * Empresas operadoras: cada uma com as próprias credenciais da Track7.
 * É a unidade que o órgão gestor exige individualizar nos relatórios.
 */
export function OperatorsPage() {
  const { can } = useAuth();
  const { refresh, setOperatorId } = useOperator();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Operator | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['operators', 'all'],
    queryFn: () => api<{ operators: Operator[] }>('/operators', { query: { includeInactive: true } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['operators'] });
    refresh();
  };

  const remove = useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      api(`/operators/${id}`, { method: 'DELETE', body: { confirmName } }),
    onSuccess: () => {
      setNotice('Empresa operadora excluída.');
      setOperatorId(null);
      invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const operators = data?.operators ?? [];

  return (
    <>
      <PageHeader
        icon={<Building2 className="h-6 w-6" />}
        title="Empresas operadoras"
        subtitle="Cada operadora tem credenciais próprias da Track7, coletor próprio e frota separada."
        actions={
          can('ADMIN', 'MANAGER') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Nova operadora
            </Button>
          )
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !operators.length ? (
          <EmptyState
            icon={<Building2 className="h-10 w-10" />}
            title="Nenhuma empresa operadora"
            description="Cadastre a primeira para configurar as credenciais da Track7."
          />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Empresa</Th>
                <Th>Código</Th>
                <Th>CNPJ</Th>
                <Th>Frota</Th>
                <Th>Credenciais</Th>
                <Th>Última posição</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {operators.map((op) => (
                <tr key={op.id} className="hover:bg-slate-50/70">
                  <Td>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-800">{op.name}</p>
                      {op.apiVisible === false && (
                        <span title="Não aparece mais na API da Track7">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {op.shortName && op.shortName !== op.name ? `${op.shortName} · ` : ''}
                      {op.source === 'DESCOBERTA' ? 'descoberta pela API' : 'cadastro manual'}
                    </p>
                  </Td>
                  <Td className="font-mono text-xs">{op.code ?? '—'}</Td>
                  <Td>{op.document ?? '—'}</Td>
                  <Td>{formatNumber(op.stats?.veiculos)}</Td>
                  <Td>
                    {op.stats?.credenciais ? (
                      <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                        Cadastradas
                      </Badge>
                    ) : (
                      <Badge tone="warning" icon={<XCircle className="h-3.5 w-3.5" />}>
                        Pendentes
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <span title={formatDateTime(op.stats?.ultima_posicao)}>
                      {op.stats?.ultima_posicao ? timeAgo(op.stats.ultima_posicao) : '—'}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={op.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {op.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </Td>
                  <Td>
                    {can('ADMIN', 'MANAGER') && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(op)}>
                          Editar
                        </Button>
                        {can('ADMIN') && (
                          <Button
                            size="sm"
                            variant="danger"
                            title="Excluir operadora"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => {
                              const confirmName = prompt(
                                `Excluir "${op.name}" apaga todos os dados sincronizados dela.\n\nDigite o nome exato para confirmar:`,
                              );
                              if (confirmName) remove.mutate({ id: op.id, confirmName });
                            }}
                          />
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <OperatorFormModal
        open={creating || editing !== null}
        operator={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          setNotice(message);
          invalidate();
        }}
      />
    </>
  );
}

function OperatorFormModal({
  open,
  operator,
  onClose,
  onSaved,
}: {
  open: boolean;
  operator: Operator | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    shortName: '',
    code: '',
    document: '',
    notes: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: operator?.name ?? '',
      shortName: operator?.shortName ?? '',
      code: operator?.code ?? '',
      document: operator?.document ?? '',
      notes: operator?.notes ?? '',
      status: operator?.status ?? 'ACTIVE',
    });
    setError(null);
  }, [operator, open]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        shortName: form.shortName || undefined,
        code: form.code || undefined,
        document: form.document || undefined,
        notes: form.notes || undefined,
        ...(operator ? { status: form.status } : {}),
      };
      return operator
        ? api(`/operators/${operator.id}`, { method: 'PATCH', body })
        : api('/operators', { method: 'POST', body });
    },
    onSuccess: () => {
      onSaved(operator ? 'Operadora atualizada.' : 'Operadora criada. Configure as credenciais em Configurações › Integrações.');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={operator ? 'Editar operadora' : 'Nova empresa operadora'}
      subtitle={operator ? undefined : 'Depois de criar, cadastre as credenciais da Track7 dela.'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Razão social">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome curto" hint="Exibido no seletor do topo.">
            <Input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
          </Field>
          <Field label="Código" hint="Identificador da empresa no consórcio.">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
        </div>
        <Field label="CNPJ">
          <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
        </Field>
        <Field label="Observações">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
