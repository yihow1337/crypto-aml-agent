/** Workers Free allows 50 subrequests per invocation; stop a little earlier to leave headroom. */
export const DEFAULT_SUBREQUEST_LIMIT = 45;

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  constructor(limit: number) {
    super(`subrequest budget of ${limit} exhausted`);
  }
}

export class UpstreamError extends Error {
  readonly code = 'UPSTREAM_ERROR';
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

/** Counts outbound fetches for one invocation so the agent loop can't exceed the platform limit. */
export class SubrequestBudget {
  used = 0;
  constructor(
    readonly limit = DEFAULT_SUBREQUEST_LIMIT,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  remaining(): number {
    return this.limit - this.used;
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.used >= this.limit) throw new BudgetExceededError(this.limit);
    this.used++;
    return this.fetcher(url, init);
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function redact(url: string): string {
  return url.replace(/([?&]apikey=)[^&]+/i, '$1***');
}

async function fetchWithRetry(
  budget: SubrequestBudget,
  url: string,
  init: RequestInit | undefined,
  opts: FetchJsonOptions,
  accept: string,
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 1, retryDelayMs = 500 } = opts;
  let lastError: UpstreamError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);
    let res: Response;
    try {
      res = await budget.fetch(url, {
        ...init,
        headers: { accept, ...(init?.headers ?? {}) },
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      lastError = new UpstreamError(0, redact(url), `network error: ${(e as Error).message}`);
      continue;
    }
    if (res.ok) return res;
    lastError = new UpstreamError(res.status, redact(url), `HTTP ${res.status} from ${new URL(url).host}`);
    const detail = await res.text().catch(() => '');
    console.warn(`upstream ${res.status} ${redact(url).slice(0, 160)} :: ${detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (res.status !== 429 && res.status < 500) throw lastError;
  }
  throw lastError!;
}

/** GET/POST JSON with a timeout and one retry on 429/5xx/network errors. Each attempt uses budget. */
export async function fetchJson<T>(
  budget: SubrequestBudget,
  url: string,
  init?: RequestInit,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const res = await fetchWithRetry(budget, url, init, opts, 'application/json');
  return (await res.json()) as T;
}

export async function fetchText(
  budget: SubrequestBudget,
  url: string,
  init?: RequestInit,
  opts: FetchJsonOptions = {},
): Promise<string> {
  const res = await fetchWithRetry(budget, url, init, opts, 'text/plain');
  return res.text();
}
