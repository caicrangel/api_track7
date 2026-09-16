import { BarChart3, KeyRound, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FleetGov</h1>
            <p className="mt-1 text-sm text-slate-500">
              Gestão de frota com telemetria Track7
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="E-mail">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@orgao.gov.br"
                className="pl-9"
              />
            </div>
          </Field>

          <Field label="Senha">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </Field>

          <Button type="submit" variant="primary" loading={loading} className="w-full">
            Entrar
          </Button>

          <p className="text-center text-xs text-slate-400">
            Acesso restrito a usuários autorizados. Todas as ações são registradas.
          </p>
        </form>
      </div>
    </div>
  );
}
