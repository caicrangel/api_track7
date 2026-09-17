/**
 * Cliente da API oficial da Track7 (plataforma MiX Telematics · MiX Integrate).
 *
 * Autenticação: OpenID Connect · Resource Owner Password Flow
 *   POST {identityUrl}/connect/token
 *   Authorization: Basic base64(client_id:client_secret)
 *   grant_type=password&username=…&password=…&scope=offline_access MiX.Integrate
 *
 * Rotas utilizadas (conforme a biblioteca oficial MiX.Integrate.Api.Client):
 *   GET  api/organisationgroups                       → organizações disponíveis ao login
 *   GET  api/organisationgroups/subgroups/{groupId}   → hierarquia de grupos/sites
 *   GET  api/assets/group/{groupId}                   → veículos (assets) do grupo
 *   GET  api/drivers/organisation/{organisationId}    → motoristas da organização
 *   POST api/positions/groups/latest/{quantity}       → últimas posições (body: [groupIds])
 *   POST api/positions/assets/from/{from}/to/{to}     → posições por período (body: [assetIds])
 *   POST api/trips/assets/from/{from}/to/{to}         → viagens por período (body: [assetIds])
 *   POST api/events/assets/from/{from}/to/{to}        → eventos por período (body: EventFilter)
 *   GET  api/libraryevents/organisation/{organisationId} → biblioteca de tipos de evento
 *   GET  api/positions/groups/createdsince/organisation/{organisationId}/sincetoken/{t}/quantity/{q}
 *                                                     → fluxo contínuo de posições (tempo real)
 *
 * Datas nos segmentos de URL usam o formato yyyyMMddHHmmss em UTC.
 * Posições, viagens e eventos aceitam no máximo 7 dias por chamada — use
 * `splitWindows()` para fatiar períodos maiores.
 */
import { upstream } from '../../lib/errors.js';


/**
 * Os identificadores da Track7 BR passam de 2^53 (a organização do consórcio é
 * um deles). JSON.parse os converte para double e perde dígitos em silêncio —
 * 1709358234985169000 chega como 1709358234985168896. O id corrompido é aceito
 * pelo nosso código e rejeitado pela API, que responde 401 para algo que nunca
 * existiu. O reviver abaixo lê o texto original de cada número e preserva como
 * string o que não couber em number; o resto segue number.
 */
function parseLossless(text: string): unknown {
  return JSON.parse(text, function (_key, value, context?: { source?: string }) {
    if (typeof value === 'number' && typeof context?.source === 'string') {
      return Number.isSafeInteger(value) ? value : context.source;
    }
    return value;
  });
}

/**
 * Serializa uma lista de ids para o corpo JSON preservando os dígitos.
 * A API espera literais numéricos; enviar "1709..." entre aspas é outro tipo,
 * e enviar como number perderia precisão nos ids longos. JSON.rawJSON insere o
 * literal exato na saída do JSON.stringify.
 */
function rawIds(ids: ReadonlyArray<number | string>): unknown[] {
  const raw = (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON;
  return ids.map((id) => raw(String(id)));
}

export interface Track7Config {
  identityUrl: string;
  apiUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface Track7Group {
  GroupId: number;
  Name: string;
  Type?: number | string;
  DisplayTimeZone?: string;
  SubGroups?: Track7Group[];
}

export interface Track7Asset {
  AssetId: number;
  AssetTypeId?: number;
  Description?: string;
  RegistrationNumber?: string;
  FleetNumber?: string;
  SiteId?: number;
  Make?: string;
  Model?: string;
  Year?: string;
  VinNumber?: string;
  EngineNumber?: string;
  SerialNumber?: string;
  Colour?: string;
  FuelType?: string;
  FuelTankCapacity?: number | null;
  TargetFuelConsumption?: number | null;
  Odometer?: number | null;
  EngineHours?: string | null;
  DefaultDriverId?: number | null;
  Country?: string;
  Icon?: string;
  IconColour?: string;
  Notes?: string;
  IsConnectedTrailer?: boolean;
  CreatedBy?: string;
  CreatedDate?: string;
  [key: string]: unknown;
}

export interface Track7Driver {
  DriverId: number;
  SiteId?: number;
  Name?: string;
  EmployeeNumber?: string;
  MobileNumber?: string;
  Email?: string;
  ExtendedDriverId?: string;
  Country?: string;
  IsSystemDriver?: boolean;
  [key: string]: unknown;
}

export interface Track7Position {
  PositionId: number;
  AssetId: number;
  DriverId?: number;
  Timestamp: string;
  Latitude?: number;
  Longitude?: number;
  SpeedKilometresPerHour?: number | null;
  SpeedLimit?: number | null;
  AltitudeMetres?: number | null;
  Heading?: number | null;
  OdometerKilometres?: number | null;
  FormattedAddress?: string | null;
  Source?: string | null;
  [key: string]: unknown;
}

export interface Track7Trip {
  TripId: number;
  AssetId: number;
  DriverId?: number;
  TripStart: string;
  TripEnd?: string;
  FirstDepart?: string | null;
  LastHalt?: string | null;
  DrivingTime?: number;
  StandingTime?: number;
  Duration?: number;
  DistanceKilometers?: number;
  StartOdometerKilometers?: number | null;
  EndOdometerKilometers?: number | null;
  MaxSpeedKilometersPerHour?: number;
  MaxAccelerationKilometersPerHourPerSecond?: number;
  MaxDecelerationKilometersPerHourPerSecond?: number;
  MaxRpm?: number;
  FuelUsedLitres?: number | null;
  StartPosition?: Track7Position | null;
  EndPosition?: Track7Position | null;
  Classification?: { Classification?: string; Comment?: string } | null;
  [key: string]: unknown;
}

export interface Track7Event {
  EventId: number;
  AssetId: number;
  DriverId?: number;
  EventTypeId?: number;
  EventCategory?: string;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  Value?: number | null;
  ValueType?: string | null;
  ValueUnits?: string | null;
  SpeedLimit?: number | null;
  TotalTimeSeconds?: number;
  TotalOccurances?: number;
  StartOdometerKilometres?: number | null;
  StartPosition?: Track7Position | null;
  [key: string]: unknown;
}

export interface Track7LibraryEvent {
  EventTypeId: number;
  Description?: string;
  EventType?: string;
  DisplayUnits?: string;
  FormatType?: string;
  ValueName?: string;
}

/**
 * Corpo exigido por api/events/*: a API não aceita uma lista simples de IDs.
 * EntityIds = ativos (ou motoristas/grupos, conforme a rota);
 * EventTypeIds = filtro opcional de tipos de evento.
 */
export interface Track7EventFilter {
  EntityIds: number[];
  EventTypeIds: number[];
  MenuId: string;
}

/**
 * Resultado das rotas `createdsince`: além dos itens, a API devolve nos
 * cabeçalhos se ainda há dados na fila (`HasMoreItems`) e o token a usar na
 * próxima chamada (`GetSinceToken`).
 */
export interface CreatedSinceResult<T> {
  items: T[];
  hasMoreItems: boolean;
  nextSinceToken: string | null;
}

/** Presets de região da plataforma MiX. */
export const TRACK7_REGIONS: Record<string, { label: string; identityUrl: string; apiUrl: string }> = {
  us: {
    label: 'Américas (US)',
    identityUrl: 'https://identity.us.mixtelematics.com/core',
    apiUrl: 'https://integrate.us.mixtelematics.com',
  },
  eu: {
    label: 'Europa (EU)',
    identityUrl: 'https://identity.eu.mixtelematics.com/core',
    apiUrl: 'https://integrate.eu.mixtelematics.com',
  },
  uk: {
    label: 'Reino Unido (UK)',
    identityUrl: 'https://identity.uk.mixtelematics.com/core',
    apiUrl: 'https://integrate.uk.mixtelematics.com',
  },
  za: {
    label: 'África do Sul (ZA)',
    identityUrl: 'https://identity.za.mixtelematics.com/core',
    apiUrl: 'https://integrate.za.mixtelematics.com',
  },
  au: {
    label: 'Austrália (AU)',
    identityUrl: 'https://identity.au.mixtelematics.com/core',
    apiUrl: 'https://integrate.au.mixtelematics.com',
  },
  om: {
    label: 'Oriente Médio (OM)',
    identityUrl: 'https://identity.om.mixtelematics.com/core',
    apiUrl: 'https://integrate.om.mixtelematics.com',
  },
  uat: {
    label: 'Homologação (UAT)',
    identityUrl: 'https://identity.uat.mixtelematics.com/core',
    apiUrl: 'https://integrate.uat.mixtelematics.com',
  },
};

/** Formato de data exigido pela API nos segmentos de URL: yyyyMMddHHmmss (UTC). */
export function toApiDate(date: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/**
 * Token do fluxo incremental: yyyyMMddHHmmssfff em UTC.
 * A API recusa tokens com mais de 7 dias; use 'NEW' para começar de agora.
 */
export function toSinceToken(date: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}${p(date.getUTCMilliseconds(), 3)}`
  );
}

/** Idade máxima aceita pela API para um sinceToken. */
export const SINCE_TOKEN_MAX_AGE_MS = 7 * 86_400_000;

/** "HH:MM:SS" (TimeSpan do .NET) → segundos. */
export function timeSpanToSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Math.round(value);
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)(?:\.\d+)?$/);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
  );
}

/**
 * Fatia um período em janelas de no máximo `maxDays` dias — limite imposto
 * pela API em posições, viagens e eventos.
 */
export function splitWindows(from: Date, to: Date, maxDays = 7): Array<[Date, Date]> {
  const windows: Array<[Date, Date]> = [];
  const maxMs = maxDays * 86_400_000;
  let cursor = from.getTime();
  const end = to.getTime();
  if (cursor >= end) return [[from, to]];
  while (cursor < end) {
    const next = Math.min(cursor + maxMs, end);
    windows.push([new Date(cursor), new Date(next)]);
    cursor = next;
  }
  return windows;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

export class Track7Client {
  private readonly config: Track7Config;
  private token: TokenState | null = null;
  private inflightToken: Promise<string> | null = null;

  constructor(config: Track7Config) {
    this.config = { timeoutMs: 60_000, ...config };
  }

  /** URL do endpoint de token, tolerante ao que o usuário cadastrou. */
  private tokenUrl(): string {
    const base = this.config.identityUrl.trim().replace(/\/+$/, '');
    if (base.endsWith('/connect/token')) return base;
    return `${base}/connect/token`;
  }

  private apiUrl(path: string): string {
    const base = this.config.apiUrl.trim().replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}`;
  }

  /** Obtém (e memoriza) o access token do Identity Server da Track7. */
  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.accessToken;
    }
    if (this.inflightToken) return this.inflightToken;

    this.inflightToken = (async () => {
      const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'password',
        username: this.config.username,
        password: this.config.password,
        scope: this.config.scope || 'offline_access MiX.Integrate',
      });

      let response: Response;
      try {
        response = await fetch(this.tokenUrl(), {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
        });
      } catch (err) {
        throw upstream(
          `Não foi possível contactar o servidor de identidade da Track7 (${this.tokenUrl()}): ${(err as Error).message}`,
        );
      }

      const text = await response.text();
      if (!response.ok) {
        let detail = text.slice(0, 500);
        try {
          const parsed = JSON.parse(text) as { error?: string; error_description?: string };
          detail = parsed.error_description || parsed.error || detail;
        } catch {
          /* mantém o texto cru */
        }
        const hint =
          response.status === 400 || response.status === 401
            ? ' Verifique Client ID, Client Secret, usuário e senha.'
            : '';
        throw upstream(`Falha na autenticação com a Track7 (HTTP ${response.status}): ${detail}.${hint}`);
      }

      const data = JSON.parse(text) as { access_token: string; expires_in?: number };
      if (!data.access_token) throw upstream('A Track7 não retornou um access_token.');

      this.token = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      return data.access_token;
    })();

    try {
      return await this.inflightToken;
    } finally {
      this.inflightToken = null;
    }
  }

  /** Executa uma chamada autenticada e devolve corpo e cabeçalhos. */
  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown; retries?: number } = {},
  ): Promise<T> {
    return (await this.requestWithHeaders<T>(path, options)).data;
  }

  /** Igual a `request`, mas preserva os cabeçalhos — usado pelo fluxo incremental. */
  private async requestWithHeaders<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown; retries?: number } = {},
  ): Promise<{ data: T; headers: Headers }> {
    const { method = 'GET', body, retries = 2 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const token = await this.getAccessToken(attempt > 0 && lastError?.message.includes('401'));
      let response: Response;
      try {
        response = await fetch(this.apiUrl(path), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
        });
      } catch (err) {
        lastError = new Error(`rede: ${(err as Error).message}`);
        if (attempt === retries) break;
        await delay(500 * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return { data: [] as unknown as T, headers: response.headers };
        const text = await response.text();
        return { data: (text ? parseLossless(text) : []) as T, headers: response.headers };
      }

      const detail = (await response.text()).slice(0, 500);
      lastError = new Error(`${response.status} ${detail}`);

      // 401 → token expirado: renova e tenta de novo. 429/5xx → backoff.
      if (response.status === 401 && attempt < retries) {
        this.token = null;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await delay(800 * 2 ** attempt);
        continue;
      }
      break;
    }

    throw upstream(`Erro ao consultar a Track7 em ${path}: ${lastError?.message ?? 'desconhecido'}`);
  }

  // ─── Endpoints ──────────────────────────────────────────

  /** Organizações disponíveis para as credenciais informadas. */
  getOrganisationGroups(): Promise<Track7Group[]> {
    return this.request<Track7Group[]>('api/organisationgroups');
  }

  /** Hierarquia de subgrupos/sites a partir de um grupo. */
  getSubGroups(groupId: number | string): Promise<Track7Group> {
    return this.request<Track7Group>(`api/organisationgroups/subgroups/${groupId}`);
  }

  /** Veículos (assets) de um grupo. */
  getAssets(groupId: number | string): Promise<Track7Asset[]> {
    return this.request<Track7Asset[]>(`api/assets/group/${groupId}`);
  }

  /** Motoristas de uma organização. */
  getDrivers(organisationId: number | string): Promise<Track7Driver[]> {
    return this.request<Track7Driver[]>(`api/drivers/organisation/${organisationId}`);
  }

  /**
   * Últimas N posições dos veículos dos grupos informados.
   * `quantity` precisa ser 1 quando há mais de um veículo (regra da API).
   */
  getLatestPositionsByGroups(
    groupIds: ReadonlyArray<number | string>,
    quantity = 1,
    ensureReverseGeocoded = true,
  ): Promise<Track7Position[]> {
    const query = ensureReverseGeocoded ? '?ensureReverseGeocoded=true' : '';
    return this.request<Track7Position[]>(`api/positions/groups/latest/${quantity}${query}`, {
      method: 'POST',
      body: rawIds(groupIds),
    });
  }

  /** Últimas N posições dos veículos informados. */
  getLatestPositionsByAssets(assetIds: ReadonlyArray<number | string>, quantity = 1): Promise<Track7Position[]> {
    return this.request<Track7Position[]>(`api/positions/assets/latest/${quantity}`, {
      method: 'POST',
      body: rawIds(assetIds),
    });
  }

  /** Posições de um período (máximo de 7 dias por chamada). */
  getPositionsByAssets(assetIds: ReadonlyArray<number | string>, from: Date, to: Date): Promise<Track7Position[]> {
    return this.request<Track7Position[]>(
      `api/positions/assets/from/${toApiDate(from)}/to/${toApiDate(to)}`,
      { method: 'POST', body: rawIds(assetIds) },
    );
  }

  /** Viagens de um período (máximo de 7 dias por chamada). */
  getTripsByAssets(assetIds: ReadonlyArray<number | string>, from: Date, to: Date): Promise<Track7Trip[]> {
    return this.request<Track7Trip[]>(`api/trips/assets/from/${toApiDate(from)}/to/${toApiDate(to)}`, {
      method: 'POST',
      body: rawIds(assetIds),
    });
  }

  /**
   * Eventos de um período (máximo de 7 dias por chamada).
   * A rota exige um EventFilter no corpo — uma lista de IDs é rejeitada.
   */
  getEventsByAssets(
    assetIds: ReadonlyArray<number | string>,
    from: Date,
    to: Date,
    eventTypeIds: ReadonlyArray<number | string> = [],
  ): Promise<Track7Event[]> {
    const filter = { EntityIds: rawIds(assetIds), EventTypeIds: rawIds(eventTypeIds), MenuId: '' };
    return this.request<Track7Event[]>(`api/events/assets/from/${toApiDate(from)}/to/${toApiDate(to)}`, {
      method: 'POST',
      body: filter,
    });
  }

  /**
   * Fluxo contínuo de posições da organização — a base do coletor de tempo real.
   *
   * `sinceToken` é o ponteiro devolvido pela chamada anterior (ou 'NEW' para
   * começar de agora). Enquanto `hasMoreItems` for true, chame de novo com o
   * `nextSinceToken` antes de dormir até o próximo ciclo.
   *
   * Limites da API: no máximo 1000 posições por entidade e token com até 7 dias.
   */
  async getPositionsCreatedSinceForOrganisation(
    organisationId: number | string,
    sinceToken: string,
    quantity = 1000,
  ): Promise<CreatedSinceResult<Track7Position>> {
    const { data, headers } = await this.requestWithHeaders<Track7Position[]>(
      `api/positions/groups/createdsince/organisation/${organisationId}/sincetoken/${sinceToken}/quantity/${quantity}`,
    );
    return this.toCreatedSinceResult(data, headers);
  }

  /** Mesma coisa, restrito a um conjunto de grupos/sites. */
  async getPositionsCreatedSinceForGroups(
    groupIds: ReadonlyArray<number | string>,
    sinceToken: string,
    quantity = 1000,
    entityType: 'Asset' | 'Driver' = 'Asset',
  ): Promise<CreatedSinceResult<Track7Position>> {
    const { data, headers } = await this.requestWithHeaders<Track7Position[]>(
      `api/positions/groups/createdsince/entitytype/${entityType}/sincetoken/${sinceToken}/quantity/${quantity}`,
      { method: 'POST', body: rawIds(groupIds) },
    );
    return this.toCreatedSinceResult(data, headers);
  }

  private toCreatedSinceResult(
    items: Track7Position[],
    headers: Headers,
  ): CreatedSinceResult<Track7Position> {
    const hasMore = headers.get('HasMoreItems') ?? headers.get('hasmoreitems');
    return {
      items: items ?? [],
      hasMoreItems: String(hasMore).toLowerCase() === 'true',
      nextSinceToken: headers.get('GetSinceToken') ?? headers.get('getsincetoken'),
    };
  }

  /** Biblioteca de tipos de evento da organização (descrições legíveis). */
  getLibraryEvents(organisationId: number | string): Promise<Track7LibraryEvent[]> {
    return this.request<Track7LibraryEvent[]>(`api/libraryevents/organisation/${organisationId}`);
  }

  /** Teste de conectividade: autentica e lista as organizações visíveis. */
  async testConnection(): Promise<{ ok: true; organisations: Array<{ groupId: number | string; name: string; type?: number | string }> }> {
    await this.getAccessToken(true);
    const groups = await this.getOrganisationGroups();
    return {
      ok: true,
      organisations: groups.map((g) => ({ groupId: g.GroupId, name: g.Name, type: g.Type })),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
