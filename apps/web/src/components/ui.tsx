import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect } from 'react';

// ─── Botão ───────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  size?: 'sm' | 'md';
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-200 border-transparent',
  secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200 focus:ring-slate-200',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent focus:ring-slate-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-transparent focus:ring-red-200',
};

export function Button({
  variant = 'secondary',
  icon,
  loading = false,
  size = 'md',
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variantClasses[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Campos ──────────────────────────────────────────────
interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('input-base', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx('input-base pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-3 disabled:opacity-60"
    >
      <span
        className={clsx(
          'relative h-6 w-11 rounded-full transition',
          checked ? 'bg-brand-500' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </button>
  );
}

// ─── Cartões e cabeçalhos ────────────────────────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-1 text-brand-600">{icon}</div>}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    default: 'text-slate-900',
    success: 'text-brand-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  } as const;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className={clsx('mt-2 text-2xl font-semibold', tones[tone])}>{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        {icon && <div className="rounded-lg bg-slate-50 p-2 text-slate-400">{icon}</div>}
      </div>
    </Card>
  );
}

// ─── Badge ───────────────────────────────────────────────
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  success: 'bg-brand-50 text-brand-700 ring-brand-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export function Badge({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        badgeTones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ─── Estados ─────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-700">{title}</h3>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Carregando...'}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    success: 'border-brand-200 bg-brand-50 text-brand-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-800',
  } as const;
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className={clsx('mt-10 w-full rounded-xl bg-white shadow-xl', widths[size])}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Tabela ──────────────────────────────────────────────
export function Table({
  children,
  className,
  fixed = false,
}: {
  children: ReactNode;
  className?: string;
  /** Larguras fixas por coluna — necessário para o texto quebrar em vez de transbordar. */
  fixed?: boolean;
}) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table
        className={clsx(
          'divide-y divide-slate-200 text-sm',
          fixed ? 'w-full table-fixed' : 'min-w-full',
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  wrap = false,
}: {
  children?: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  return (
    <th
      className={clsx(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
        !wrap && 'whitespace-nowrap',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  title,
  wrap = false,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
  /**
   * Permite quebra de linha. Precisa ser prop, e não classe: `whitespace-normal`
   * e `whitespace-nowrap` têm a mesma especificidade, e quem vence é a ordem no
   * CSS gerado — não a ordem no atributo class.
   */
  wrap?: boolean;
}) {
  return (
    <td
      title={title}
      className={clsx('px-4 py-3 text-slate-700', !wrap && 'whitespace-nowrap', className)}
    >
      {children}
    </td>
  );
}

// ─── Paginação ───────────────────────────────────────────
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {from}–{to} de {total.toLocaleString('pt-BR')}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Anterior
        </Button>
        <span className="text-xs text-slate-500">
          Página {page} de {pages}
        </span>
        <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
          Próxima
        </Button>
      </div>
    </div>
  );
}
