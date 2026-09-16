import clsx from 'clsx';
import clsx2 from 'clsx';
import {
  BarChart3,
  Building2,
  BookOpen,
  Check,
  ChevronDown,
  CircleUser,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  Truck,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '../lib/auth';
import { useOperator } from '../lib/operator';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
}

const OPERATION_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { to: '/veiculos', label: 'Veículos', icon: <Truck className="h-[18px] w-[18px]" /> },
  { to: '/motoristas', label: 'Motoristas', icon: <UsersRound className="h-[18px] w-[18px]" /> },
  { to: '/relatorios', label: 'Relatórios', icon: <FileBarChart className="h-[18px] w-[18px]" /> },
];

const GLOBAL_ITEMS: NavItem[] = [
  { to: '/configuracoes', label: 'Configurações', icon: <Settings2 className="h-[18px] w-[18px]" /> },
  { to: '/operadoras', label: 'Operadoras', icon: <Building2 className="h-[18px] w-[18px]" />, roles: ['ADMIN', 'MANAGER'] },
  { to: '/usuarios', label: 'Usuários', icon: <Users className="h-[18px] w-[18px]" />, roles: ['ADMIN', 'MANAGER'] },
  { to: '/ajuda', label: 'Ajuda', icon: <BookOpen className="h-[18px] w-[18px]" /> },
  { to: '/perfil', label: 'Perfil', icon: <CircleUser className="h-[18px] w-[18px]" /> },
];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'ADMINISTRADOR',
  MANAGER: 'GESTOR',
  OPERATOR: 'OPERADOR',
  VIEWER: 'CONSULTA',
};

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  const { user } = useAuth();
  const visible = items.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  if (!visible.length) return null;

  return (
    <div className="px-3 py-2">
      <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <nav className="space-y-0.5">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <OperatorSwitcher organizationName={user?.organization_name} />

      <div className="flex-1 overflow-y-auto">
        <NavSection title="Operação" items={OPERATION_ITEMS} onNavigate={() => setMobileOpen(false)} />
        <div className="mx-6 my-2 border-t border-slate-100" />
        <NavSection title="Global" items={GLOBAL_ITEMS} onNavigate={() => setMobileOpen(false)} />
      </div>

      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(user?.name ?? '?')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
            <p className="truncate text-[10px] font-semibold tracking-wide text-slate-400">
              {user ? ROLE_LABELS[user.role] : ''}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            title="Sair"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <aside className="hidden w-[260px] shrink-0 border-r border-slate-200 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] border-r border-slate-200 shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            {mobileOpen ? <Menu className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-sm font-semibold text-slate-800">FleetGov</span>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Seletor de empresa operadora — define o escopo de todas as telas.
 * Com uma única operadora cadastrada vira apenas o cabeçalho da conta.
 */
function OperatorSwitcher({ organizationName }: { organizationName?: string }) {
  const { operators, operatorId, operator, setOperatorId } = useOperator();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const multiple = operators.length > 1;

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const label = operator?.shortName ?? operator?.name ?? (multiple ? 'Todas as operadoras' : organizationName);

  return (
    <div ref={ref} className="relative border-b border-slate-100">
      <button
        type="button"
        disabled={!multiple}
        onClick={() => setOpen((v) => !v)}
        className={clsx2(
          'flex w-full items-center gap-2 px-5 py-4 text-left transition',
          multiple && 'hover:bg-slate-50',
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BarChart3 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{label ?? 'FleetGov'}</p>
          <p className="truncate text-[11px] text-slate-400">
            {multiple ? `${operators.length} empresas operadoras` : (organizationName ?? 'Gestão de frota')}
          </p>
        </div>
        {multiple && <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {open && multiple && (
        <div className="absolute left-3 right-3 top-[68px] z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <button
            onClick={() => {
              setOperatorId(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
          >
            <span className={operatorId === null ? 'font-medium text-brand-700' : 'text-slate-700'}>
              Todas as operadoras
            </span>
            {operatorId === null && <Check className="h-4 w-4 text-brand-600" />}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {operators.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOperatorId(item.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span
                  className={clsx2(
                    'block truncate text-sm',
                    item.id === operatorId ? 'font-medium text-brand-700' : 'text-slate-700',
                  )}
                >
                  {item.shortName ?? item.name}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {item.stats?.veiculos ?? 0} veículos
                  {item.stats?.credenciais === false ? ' · sem credenciais' : ''}
                </span>
              </span>
              {item.id === operatorId && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { X };
