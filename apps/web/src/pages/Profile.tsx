import { useMutation } from '@tanstack/react-query';
import { CircleUser, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { Alert, Button, Card, Field, Input, PageHeader } from '../components/ui';

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Senha alterada. Você será desconectado para entrar novamente.' });
      setTimeout(() => void signOut(), 2500);
    },
    onError: (err: Error) => setFeedback({ tone: 'danger', message: err.message }),
  });

  const submit = () => {
    setFeedback(null);
    if (newPassword.length < 8) {
      setFeedback({ tone: 'danger', message: 'A nova senha precisa ter ao menos 8 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ tone: 'danger', message: 'A confirmação não confere com a nova senha.' });
      return;
    }
    change.mutate();
  };

  return (
    <>
      <PageHeader icon={<CircleUser className="h-6 w-6" />} title="Perfil" subtitle="Seus dados de acesso." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900">Dados da conta</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Nome</dt>
              <dd className="font-medium text-slate-800">{user?.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">E-mail</dt>
              <dd className="font-medium text-slate-800">{user?.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Perfil</dt>
              <dd className="font-medium text-slate-800">{user?.role}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Organização</dt>
              <dd className="font-medium text-slate-800">{user?.organization_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Último acesso</dt>
              <dd className="font-medium text-slate-800">{formatDateTime(user?.last_login_at)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-slate-400" />
            Alterar senha
          </h2>

          {user?.must_change_password && (
            <div className="mt-3">
              <Alert tone="warning">
                Você está usando uma senha temporária. Defina uma senha pessoal para continuar.
              </Alert>
            </div>
          )}

          {feedback && (
            <div className="mt-3">
              <Alert tone={feedback.tone}>{feedback.message}</Alert>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <Field label="Senha atual">
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirmar nova senha">
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button variant="primary" loading={change.isPending} onClick={submit}>
              Alterar senha
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
