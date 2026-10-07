import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('adminApi', () => {
  it('sends the token in the X-Admin-Token header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi('secret-token').verify();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/admin\/verify$/);
    expect(url).not.toContain('secret-token');
    expect((init.headers as Record<string, string>)['X-Admin-Token']).toBe('secret-token');
  });

  it('posts a block reason as JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi('t').blockClient('0123456789abcdef', '濫用');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/admin\/clients\/0123456789abcdef\/block$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: '濫用' });
  });

  it('maps 403 to a FORBIDDEN error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '需要有效的管理員權杖。' } }), { status: 403 })));
    await expect(adminApi('bad').verify()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
