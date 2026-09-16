import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';
import { formatDateTime } from '../lib/format';
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
  Table,
  Td,
  Th,
} from '../components/ui';

interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
  phone: string | null;
  job_title: string | null;
  last_login_at: string | null;
  created_at: string;
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gestor',
  OPERATOR: 'Operador',
  VIEWER: 'Consulta',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Acesso total, incluindo usuários e integrações.',
  MANAGER: 'Gerencia integrações, relatórios e consulta tudo.',
  OPERATOR: 'Executa sincronizações e consulta os módulos.',
  VIEWER: 'Apenas consulta e exportação de relatórios.',
};

export function UsersPage() {
  const { can, user: me } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SystemUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['users', debounced, page],
    queryFn: () =>
      api<{ data: SystemUser[]; page: number; pageSize: number; total: number }>('/users', {
        query: { search: debounced, page, pageSize: 25 },
      }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setNotice('Usuário removido.');
      void invalidate();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword?: string }>(`/users/${id}/reset-password`, { method: 'POST', body: {} }),
    onSuccess: (result) =>
      setNotice(
        result.temporaryPassword
          ? `Senha redefinida. Senha temporária: ${result.temporaryPassword}`
          : 'Senha redefinida.',
      ),
    onError: (err: Error) => setNotice(err.message),
  });

  return (
    <>
      <PageHeader
        icon={<Users className="h-6 w-6" />}
        title="Usuários"
        subtitle="Contas com acesso ao sistema e seus perfis de permissão."
        actions={
          can('ADMIN') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Novo usuário
            </Button>
          )
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      <Card className="mb-4 p-4">
        <Field label="Buscar" className="max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou e-mail" className="pl-9" />
          </div>
        </Field>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState icon={<Users className="h-10 w-10" />} title="Nenhum usuário encontrado" />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Nome</Th>
                  <Th>E-mail</Th>
                  <Th>Perfil</Th>
                  <Th>Situação</Th>
                  <Th>Último acesso</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/70">
                    <Td>
                      <p className="font-medium text-slate-800">{user.name}</p>
                      {user.job_title && <p className="text-xs text-slate-400">{user.job_title}</p>}
                    </Td>
                    <Td>{user.email}</Td>
                    <Td>
                      <Badge tone={user.role === 'ADMIN' ? 'info' : 'neutral'}>{ROLE_LABELS[user.role]}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={user.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {user.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </Td>
                    <Td>{formatDateTime(user.last_login_at)}</Td>
                    <Td>
                      {can('ADMIN') && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(user)}>
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            icon={<KeyRound className="h-3.5 w-3.5" />}
                            onClick={() => {
                              if (confirm(`Redefinir a senha de ${user.name}?`)) resetPassword.mutate(user.id);
                            }}
                          >
                            Senha
                          </Button>
                          {user.id !== me?.id && (
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => {
                                if (confirm(`Excluir ${user.name}? Esta ação não pode ser desfeita.`)) remove.mutate(user.id);
                              }}
                            >
                              Excluir
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <UserFormModal
        open={creating || editing !== null}
        user={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          setNotice(message);
          void invalidate();
        }}
      />
    </>
  );
}

function UserFormModal({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: SystemUser | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'VIEWER' as Role,
    phone: '',
    jobTitle: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone ?? '',
        jobTitle: user.job_title ?? '',
        status: user.status,
        password: '',
      });
    } else {
      setForm({ name: '', email: '', role: 'VIEWER', phone: '', jobTitle: '', status: 'ACTIVE', password: '' });
    }
    setError(null);
  }, [user, open]);

  const save = useMutation({
    mutationFn: async () => {
      if (user) {
        return api(`/users/${user.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            email: form.email,
            role: form.role,
            status: form.status,
            phone: form.phone,
            jobTitle: form.jobTitle,
          },
        });
      }
      return api<{ temporaryPassword?: string }>('/users', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          role: form.role,
          phone: form.phone || undefined,
          jobTitle: form.jobTitle || undefined,
          password: form.password || undefined,
        },
      });
    },
    onSuccess: (result) => {
      const temporary = (result as { temporaryPassword?: string })?.temporaryPassword;
      onSaved(
        user
          ? 'Usuário atualizado.'
          : temporary
            ? `Usuário criado. Senha temporária: ${temporary}`
            : 'Usuário criado.',
      );
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Editar usuário' : 'Novo usuário'}
      subtitle={user ? user.email : 'Uma senha temporária será gerada se você não definir uma.'}
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
        <Field label="Nome completo">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cargo">
            <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Perfil de acesso" hint={ROLE_DESCRIPTIONS[form.role]}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        {user ? (
          <Field label="Situação">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </Select>
          </Field>
        ) : (
          <Field label="Senha inicial (opcional)" hint="Deixe vazio para gerar uma senha temporária.">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
