import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, describeError, errorFromResponse, parseRetryAfter, toApiError, withTimeout } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('1.2')).toBe(2);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 15_000).toUTCString(), now)).toBe(15);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('errorFromResponse', () => {
  it('reads the { error: { code, message } } body', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'INVALID_ADDRESS', message: 'bad checksum' } }), { status: 400 });
    const err = await errorFromResponse(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'INVALID_ADDRESS', message: 'bad checksum', status: 400 });
  });

  it('carries Retry-After for rate limits', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down' } }), {
      status: 429,
      headers: { 'Retry-After': '12' },
    });
    const err = await errorFromResponse(res);
    expect(err.retryAfter).toBe(12);
    expect(describeError(err).title).toContain('12 秒');
  });

  it('falls back to a status-derived code for non-JSON bodies', async () => {
    const err = await errorFromResponse(new Response('<html>Bad Gateway</html>', { status: 502 }));
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.message).toContain('Bad Gateway');
  });

  it('ignores unknown server codes', async () => {
    const err = await errorFromResponse(new Response(JSON.stringify({ error: { code: 'WAT', message: 'x' } }), { status: 404 }));
    expect(err.code).toBe('NOT_FOUND');
  });
});

describe('toApiError', () => {
  it('maps fetch failures and aborts', () => {
    expect(toApiError(new TypeError('Failed to fetch')).code).toBe('NETWORK_ERROR');
    expect(toApiError(new DOMException('Aborted', 'AbortError')).code).toBe('ABORTED');
    expect(describeError(new TypeError('Failed to fetch')).title).toContain('無法連線');
  });
});

describe('timeouts', () => {
  it('maps TimeoutError to TIMEOUT', () => {
    expect(toApiError(new DOMException('t', 'TimeoutError')).code).toBe('TIMEOUT');
    expect(describeError(new DOMException('t', 'TimeoutError')).title).toContain('逾時');
  });

  it('aborts with TimeoutError after the deadline but still honours the caller signal', async () => {
    const s = withTimeout(undefined, 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.aborted).toBe(true);
    expect((s.reason as DOMException).name).toBe('TimeoutError');
    const user = new AbortController();
    const s2 = withTimeout(user.signal, 10_000);
    user.abort();
    expect(s2.aborted).toBe(true);
  });

  it('turns a hanging request into a TIMEOUT error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
      ),
    );
    const { apiFetch } = await import('./api');
    await expect(apiFetch('/api/health', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('api client', () => {
  it('builds query strings and parses JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.alerts({ limit: 50, chain: '', severity: 'high' });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/\/api\/alerts\?limit=50&severity=high$/);
  });

  it('throws ApiError on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'CHAIN_UNAVAILABLE', message: 'no key' } }), { status: 503 })),
    );
    await expect(api.analyze('bsc', '0x0000000000000000000000000000000000000000')).rejects.toMatchObject({
      code: 'CHAIN_UNAVAILABLE',
      status: 503,
    });
  });

  it('normalises network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(api.health()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('describeError for addresses a data source will not serve', () => {
  it('does not tell the user to retry later for a 422 upstream error', () => {
    const err = new ApiError('UPSTREAM_ERROR', 'Zerion 不追蹤此地址（多為交易所熱錢包等超大量地址），無法即時分析。', 422);
    const d = describeError(err);
    expect(d.title).toBe('此地址無法即時分析。');
    expect(d.title).not.toContain('稍後');
    expect(d.detail).toContain('Zerion');
  });

  it('keeps the temporary-outage wording for 5xx upstream errors', () => {
    expect(describeError(new ApiError('UPSTREAM_ERROR', 'HTTP 502', 502)).title).toContain('稍後再試');
  });
});
