import type {
  AdminClientsResponse,
  AdminJobName,
  AdminJobRunResponse,
  AdminOverview,
  AlertsResponse,
  AnalyzeResponse,
  ApiErrorCode,
  Chain,
  DetectResponse,
  HealthResponse,
  InvestigationDetail,
  InvestigationListResponse,
  ScenarioListResponse,
  Severity,
  StatsResponse,
  WatchlistItem,
  WatchlistResponse,
} from '@aml/engine';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787').replace(/\/+$/, '');

/** Server error codes plus client-side failure modes. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'BAD_RESPONSE' | 'ABORTED' | 'STREAM_ERROR';

/** Client-side request timeouts (ms). /api/analyze fetches chain data and may take a while. */
export const TIMEOUT_MS = { default: 20_000, analyze: 90_000 } as const;

/** Combine a caller's abort signal with a timeout (TimeoutError on expiry). */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const ctrl = new AbortController();
  const forward = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  signal.addEventListener('abort', forward(signal), { once: true });
  timeout.addEventListener('abort', forward(timeout), { once: true });
  return ctrl.signal;
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  /** Seconds to wait before retrying (from `Retry-After`), when provided. */
  readonly retryAfter?: number;

  constructor(code: ClientErrorCode, message: string, status = 0, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const KNOWN_CODES = new Set<string>([
  'INVALID_ADDRESS',
  'UNSUPPORTED_CHAIN',
  'NOT_FOUND',
  'UPSTREAM_ERROR',
  'RATE_LIMITED',
  'BUDGET_EXCEEDED',
  'QUOTA_EXCEEDED',
  'CHAIN_UNAVAILABLE',
  'FORBIDDEN',
  'BAD_REQUEST',
  'INTERNAL',
]);

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 403 || status === 401) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503 || status === 504) return 'UPSTREAM_ERROR';
  return 'INTERNAL';
}

/** Parse `Retry-After` (delta-seconds or HTTP-date) into whole seconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.max(0, Math.ceil(Number(v)));
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Normalise a non-2xx response into an ApiError (reads the `{ error: { code, message } }` body). */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
  let code: ClientErrorCode = codeForStatus(res.status);
  let message = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
        if (body?.error) {
          if (typeof body.error.code === 'string' && KNOWN_CODES.has(body.error.code)) {
            code = body.error.code as ApiErrorCode;
          }
          if (typeof body.error.message === 'string' && body.error.message) message = body.error.message;
        }
      } catch {
        message = text.slice(0, 200);
      }
    }
  } catch {
    /* body unreadable — keep defaults */
  }
  return new ApiError(code, message, res.status, retryAfter);
}

/** Normalise anything thrown by fetch/JSON parsing into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if ((err instanceof DOMException || err instanceof Error) && err.name === 'TimeoutError') {
    return new ApiError('TIMEOUT', err.message || 'timeout');
  }
  if (err instanceof DOMException && err.name === 'AbortError') return new ApiError('ABORTED', '已取消');
  if (err instanceof Error && err.name === 'AbortError') return new ApiError('ABORTED', '已取消');
  if (err instanceof TypeError) return new ApiError('NETWORK_ERROR', err.message || 'Failed to fetch');
  if (err instanceof SyntaxError) return new ApiError('BAD_RESPONSE', err.message);
  return new ApiError('INTERNAL', err instanceof Error ? err.message : String(err));
}

export function isAbort(err: unknown): boolean {
  return err instanceof ApiError
    ? err.code === 'ABORTED'
    : (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}

type Query = Record<string, string | number | undefined | null>;

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

export async function apiFetch<T>(
  path: string,
  opts: {
    query?: Query;
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: withTimeout(opts.signal, opts.timeoutMs ?? TIMEOUT_MS.default),
      cache: 'no-store',
    });
  } catch (err) {
    throw toApiError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw toApiError(err);
  }
}

// ---- Endpoints --------------------------------------------------------------------------

export const api = {
  health: (signal?: AbortSignal) => apiFetch<HealthResponse>('/api/health', { signal }),
  detect: (address: string, signal?: AbortSignal) =>
    apiFetch<DetectResponse>('/api/detect', { query: { address }, signal }),
  analyze: (chain: Chain, address: string, signal?: AbortSignal) =>
    apiFetch<AnalyzeResponse>('/api/analyze', { query: { chain, address }, signal, timeoutMs: TIMEOUT_MS.analyze }),
  scenarios: (signal?: AbortSignal) => apiFetch<ScenarioListResponse>('/api/scenarios', { signal }),
  scenario: (id: string, signal?: AbortSignal) =>
    apiFetch<AnalyzeResponse>(`/api/scenarios/${encodeURIComponent(id)}`, { signal }),
  alerts: (q: { limit?: number; chain?: Chain | ''; severity?: Severity | ''; since?: number } = {}, signal?: AbortSignal) =>
    apiFetch<AlertsResponse>('/api/alerts', { query: q, signal }),
  stats: (signal?: AbortSignal) => apiFetch<StatsResponse>('/api/stats', { signal }),
  watchlist: (signal?: AbortSignal) => apiFetch<WatchlistResponse>('/api/watchlist', { signal }),
  addWatchlist: (body: { chain: Chain; address: string; label: string }, signal?: AbortSignal) =>
    apiFetch<WatchlistItem>('/api/watchlist', { method: 'POST', body, signal }),
  investigations: (limit = 20, signal?: AbortSignal) =>
    apiFetch<InvestigationListResponse>('/api/investigations', { query: { limit }, signal }),
  investigation: (id: string, signal?: AbortSignal) =>
    apiFetch<InvestigationDetail>(`/api/investigations/${encodeURIComponent(id)}`, { signal }),
};

/** Admin endpoints; every call sends the token in the `X-Admin-Token` header (never in the URL). */
export function adminApi(token: string) {
  const headers = { 'X-Admin-Token': token };
  const call = <T>(path: string, opts: Parameters<typeof apiFetch>[1] = {}) => apiFetch<T>(path, { ...opts, headers });
  return {
    verify: (signal?: AbortSignal) => call<{ ok: boolean }>('/api/admin/verify', { signal }),
    overview: (signal?: AbortSignal) => call<AdminOverview>('/api/admin/overview', { signal }),
    clients: (signal?: AbortSignal) => call<AdminClientsResponse>('/api/admin/clients', { signal }),
    runJob: (job: AdminJobName) => call<AdminJobRunResponse>(`/api/admin/run/${job}`, { method: 'POST', timeoutMs: 120_000 }),
    resetClient: (id: string) => call<{ ok: boolean }>(`/api/admin/clients/${encodeURIComponent(id)}/reset`, { method: 'POST' }),
    blockClient: (id: string, reason: string) =>
      call<{ ok: boolean }>(`/api/admin/clients/${encodeURIComponent(id)}/block`, { method: 'POST', body: { reason } }),
    unblockClient: (id: string) => call<{ ok: boolean }>(`/api/admin/clients/${encodeURIComponent(id)}/block`, { method: 'DELETE' }),
  };
}

export type AdminApi = ReturnType<typeof adminApi>;

// ---- Friendly zh-TW messages -----------------------------------------------------------

export interface ErrorDescription {
  title: string;
  detail?: string;
}

export function describeError(err: unknown): ErrorDescription {
  const e = toApiError(err);
  const server = e.message && !/^HTTP \d+$/.test(e.message) ? e.message : undefined;
  switch (e.code) {
    case 'INVALID_ADDRESS':
      return { title: '地址格式無效，請確認鏈別與地址是否正確。', detail: server };
    case 'UNSUPPORTED_CHAIN':
      return { title: '不支援此區塊鏈。目前支援 Ethereum、BNB Smart Chain、TRON 與 Bitcoin。', detail: server };
    case 'NOT_FOUND':
      return { title: '找不到指定的資料。', detail: server };
    case 'UPSTREAM_ERROR':
      return { title: '鏈上資料來源暫時無法回應，請稍後再試。', detail: server };
    case 'RATE_LIMITED':
      return {
        title:
          e.retryAfter !== undefined
            ? `請求過於頻繁，請於 ${e.retryAfter} 秒後再試。`
            : '請求過於頻繁，請稍候再試。',
        detail: server,
      };
    case 'BUDGET_EXCEEDED':
      return { title: '本次分析超出資料抓取預算（子請求上限），結果可能不完整，請稍後再試。', detail: server };
    case 'QUOTA_EXCEEDED':
      return { title: '已達使用上限（例如監控名單已滿）。', detail: server };
    case 'CHAIN_UNAVAILABLE':
      return { title: '此區塊鏈目前無法使用（後端未設定資料來源金鑰或來源中斷）。', detail: server };
    case 'FORBIDDEN':
      return { title: '沒有執行此操作的權限。', detail: server };
    case 'BAD_REQUEST':
      return { title: '請求內容有誤。', detail: server };
    case 'NETWORK_ERROR':
      return {
        title: '無法連線至後端 API，請確認服務是否啟動。',
        detail: `API 位址：${API_BASE}`,
      };
    case 'TIMEOUT':
      return { title: '請求逾時：後端或鏈上資料來源回應過慢，請稍後再試。', detail: `API 位址：${API_BASE}` };
    case 'BAD_RESPONSE':
      return { title: '後端回應格式無法解析。', detail: server };
    case 'STREAM_ERROR':
      return { title: 'AI Agent 串流中斷。', detail: server };
    case 'ABORTED':
      return { title: '已取消。' };
    default:
      return { title: '伺服器發生錯誤，請稍後再試。', detail: server };
  }
}
