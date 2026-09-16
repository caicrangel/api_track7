const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatNumber(value: unknown, decimals = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Segundos → "12h 30min" / "45min" / "20s". */
export function formatDuration(seconds: unknown): string {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  if (minutes > 0) return `${minutes}min`;
  return `${Math.round(total)}s`;
}

/** Tempo relativo curto: "há 5 min", "há 3 h", "há 2 d". */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'sem registro';
  const date = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return 'sem registro';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

export function formatByType(value: unknown, type?: string): string {
  switch (type) {
    case 'datetime':
      return formatDateTime(value as string);
    case 'duration':
      return formatDuration(value);
    case 'decimal':
      return formatNumber(value, 2);
    case 'number':
      return formatNumber(value, 0);
    default:
      return value === null || value === undefined || value === '' ? '—' : String(value);
  }
}
