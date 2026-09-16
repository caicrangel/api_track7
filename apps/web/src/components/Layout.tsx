import clsx from 'clsx';
import {
  BarChart3,
  BookOpen,
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
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '../lib/auth';

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
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BarChart3 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">FleetGov</p>
          <p className="truncate text-[11px] text-slate-400">{user?.organization_name ?? 'Gestão de frota'}</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </div>

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

export { X };
