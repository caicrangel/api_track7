const API_URL = import.meta.env.VITE_API_URL ?? '/api';

const ACCESS_KEY = 'fleetgov.accessToken';
const REFRESH_KEY = 'fleetgov.refreshToken';

export interface ApiErrorPayload {
  error: string;
  message: string;
  issues?: Array<{ field: string; message: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | null;

  constructor(status: number, payload: ApiErrorPayload | null) {
    super(payload?.message ?? `Erro ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        tokens.clear();
        return false;
      }
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  raw?: boolean;
  skipAuth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_URL}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, raw = false, skipAuth = false } = options;

  const execute = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: raw ? 'text/csv' : 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const accessToken = tokens.access;
    if (accessToken && !skipAuth) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let response = await execute();

  if (response.status === 401 && !skipAuth && (await refreshSession())) {
    response = await execute();
  }

  if (!response.ok) {
    let payload: ApiErrorPayload | null = null;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      tokens.clear();
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(response.status, payload);
  }

  if (raw) return (await response.text()) as unknown as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Baixa um arquivo gerado pela API (CSV) preservando o cabeçalho de autenticação. */
export async function downloadFile(
  path: string,
  filename: string,
  options: RequestOptions = {},
): Promise<void> {
  const content = await api<string>(path, { ...options, raw: true });
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
