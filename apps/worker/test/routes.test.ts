import type { AgentEvent } from '@aml/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ethSweep, tornadoRecipient, watchlistScan } from '../src/cron';
import type { Env } from '../src/env';
import { SubrequestBudget } from '../src/lib/http';
import { resetSanctionsMemo } from '../src/sanctions/store';
import { createTestD1 } from './helpers/d1-sqlite';
import { fixture, type Handler, json, mockFetch } from './helpers/fetch-mock';

const RONIN = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createTestD1(),
    GLM_BASE_URL: 'https://glm.test/api/paas/v4',
    GLM_MODEL: 'glm-test',
    GLM_THINKING: 'disabled',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    ALLOWED_ORIGIN_PATTERN: '^https://crypto-aml-agent(-[a-z0-9-]+)?\\.vercel\\.app$',
    ADMIN_TOKEN: 'admin-secret',
    ...extra,
  };
}

function ethRoutes(): [string | RegExp, Handler][] {
  return [
    ['coingecko', () => ({ ethereum: { usd: 2500 }, binancecoin: { usd: 600 }, tron: { usd: 0.3 }, bitcoin: { usd: 80000 } })],
    ['/internal-transactions', () => ({ items: [], next_page_params: null })],
    ['/token-transfers', () => fixture('bs-tokentransfers-ronin.json')],
    ['/transactions', () => fixture('bs-v2-transactions-ronin.json')],
    ['/counters', () => fixture('bs-counters-ronin.json')],
    ['/api/v2/addresses/', () => fixture('bs-address-ronin.json')],
  ];
}

function parseSse(text: string): AgentEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(5).trim()) as AgentEvent);
}

beforeEach(() => resetSanctionsMemo());

describe('health, detect, CORS', () => {
  it('reports sanctions counts and chain availability', async () => {
    const app = createApp({ fetcher: mockFetch([]).fetch });
    const res = await app.request('/api/health', {}, makeEnv());
    const body = (await res.json()) as { ok: boolean; sanctions: { counts: { total: number } }; chains: { bsc: { available: boolean } }; glm: { configured: boolean } };
    expect(body.ok).toBe(true);
    expect(body.sanctions.counts.total).toBeGreaterThan(900);
    expect(body.chains.bsc.available).toBe(false);
    expect(body.glm.configured).toBe(false);
  });

  it('allows configured and Vercel preview origins, rejects others', async () => {
    const app = createApp();
    const env = makeEnv();
    const pre = (origin: string) =>
      app.request('/api/health', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } }, env);
    expect((await pre('http://localhost:3000')).headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect((await pre('https://crypto-aml-agent-git-main-abc.vercel.app')).headers.get('access-control-allow-origin')).toBe(
      'https://crypto-aml-agent-git-main-abc.vercel.app',
    );
    expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('detects TRON addresses', async () => {
    const app = createApp();
    const res = await app.request('/api/detect?address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', {}, makeEnv());
    expect(await res.json()).toEqual({ valid: true, candidates: ['tron'] });
  });

  it('returns 429 with Retry-After when the rate limiter refuses', async () => {
    const app = createApp();
    const env = makeEnv({ RL_API: { limit: async () => ({ success: false }) } as unknown as RateLimit });
    const res = await app.request('/api/detect?address=x', {}, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});

describe('/api/analyze', () => {
  it('rejects an invalid address', async () => {
    const res = await createApp().request('/api/analyze?chain=eth&address=0x123', {}, makeEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_ADDRESS');
  });

  it('returns 503 for BSC without a Zerion key', async () => {
    const m = mockFetch(ethRoutes());
    const res = await createApp({ fetcher: m.fetch }).request(`/api/analyze?chain=bsc&address=${RONIN}`, {}, makeEnv());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CHAIN_UNAVAILABLE');
  });

  it('analyzes a live ETH address and serves the second call from cache', async () => {
    const m = mockFetch(ethRoutes());
    const app = createApp({ fetcher: m.fetch });
    const env = makeEnv();
    const res = await app.request(`/api/analyze?chain=eth&address=${RONIN}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { score: number; level: string; cached: boolean; hits: { id: string }[]; mode: string };
    expect(body.score).toBe(100);
    expect(body.level).toBe('critical');
    expect(body.hits.map((h) => h.id)).toContain('R01');
    expect(body.cached).toBe(false);
    expect(body.mode).toBe('live');
    const calls = m.calls.length;
    const again = (await (await app.request(`/api/analyze?chain=eth&address=${RONIN.toLowerCase()}`, {}, env)).json()) as { cached: boolean };
    expect(again.cached).toBe(true);
    expect(m.calls.length).toBe(calls);
  });
});

describe('/api/scenarios', () => {
  it('lists and analyzes scenarios', async () => {
    const app = createApp();
    const env = makeEnv();
    const list = (await (await app.request('/api/scenarios', {}, env)).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(10);
    const s1 = (await (await app.request('/api/scenarios/s1', {}, env)).json()) as { level: string; mode: string; scenario: { id: string } };
    expect(s1.level).toBe('critical');
    expect(s1.mode).toBe('scenario');
    expect(s1.scenario.id).toBe('s1');
    expect((await app.request('/api/scenarios/zzz', {}, env)).status).toBe(404);
  });
});

describe('/api/watchlist', () => {
  const post = (app: ReturnType<typeof createApp>, env: Env, address: string, chain = 'eth') =>
    app.request('/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain, address, label: '測試' }) }, env);

  it('adds, deduplicates, enforces per-IP quota and protects deletes', async () => {
    const app = createApp();
    const env = makeEnv();
    const first = await post(app, env, RONIN);
    expect(first.status).toBe(201);
    const item = (await first.json()) as { id: number; address: string };
    expect(item.address).toBe(RONIN.toLowerCase());
    const dup = await post(app, env, RONIN.toLowerCase());
    expect(((await dup.json()) as { id: number }).id).toBe(item.id);
    expect((await post(app, env, '0x123')).status).toBe(400);
    expect((await post(app, env, '0x0000000000000000000000000000000000000002')).status).toBe(201);
    expect((await post(app, env, '0x0000000000000000000000000000000000000003')).status).toBe(201);
    const fourth = await post(app, env, '0x0000000000000000000000000000000000000004');
    expect(fourth.status).toBe(429);
    expect((await app.request(`/api/watchlist/${item.id}`, { method: 'DELETE' }, env)).status).toBe(403);
    expect((await app.request(`/api/watchlist/${item.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'admin-secret' } }, env)).status).toBe(200);
    const list = (await (await app.request('/api/watchlist', {}, env)).json()) as { items: unknown[]; max: number };
    expect(list.items).toHaveLength(2);
    expect(list.max).toBe(30);
  });
});

describe('/api/agent/investigate', () => {
  const investigate = (app: ReturnType<typeof createApp>, env: Env, body: unknown) =>
    app.request('/api/agent/investigate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);

  it('falls back to the template report when no GLM key is configured', async () => {
    const app = createApp({ fetcher: mockFetch([]).fetch });
    const env = makeEnv();
    const res = await investigate(app, env, { scenarioId: 's3' });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('analysis');
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'LLM_UNAVAILABLE', recoverable: true });
    expect(types.filter((t) => t === 'tool_call').length).toBeGreaterThanOrEqual(3);
    const report = events.find((e) => e.type === 'report') as Extract<AgentEvent, { type: 'report' }>;
    expect(report.source).toBe('template');
    expect(report.markdown).toContain('一、摘要');
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.investigationId).toBeTruthy();
    const saved = (await (await app.request(`/api/investigations/${done.investigationId}`, {}, env)).json()) as { reportMd: string; mode: string; trace: unknown[] };
    expect(saved.mode).toBe('scenario');
    expect(saved.reportMd).toBe(report.markdown);
    expect(saved.trace.length).toBeGreaterThan(3);
    const alerts = (await (await app.request('/api/alerts', {}, env)).json()) as { items: unknown[] };
    expect(alerts.items).toHaveLength(0);
  });

  it('runs the GLM tool-calling loop and guards the report', async () => {
    const bodies: Record<string, unknown>[] = [];
    let auth = '';
    const script = [
      { tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'get_address_profile', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'run_aml_analysis', arguments: '{}' } },
      ] },
      { tool_calls: [{ id: 'c3', type: 'function', function: { name: 'get_transactions', arguments: '{}' } }] },
      { content: `# 虛擬資產反洗錢調查報告\n## 一、摘要\n此地址疑似參與結構化交易。風險分數：12 分，風險等級：低。\n可疑地址 0xdead00000000000000000000000000000000beef 需進一步確認。\n${'補充說明。'.repeat(60)}\n## 六、資料限制與免責聲明\n本報告僅供參考。` },
    ];
    let i = 0;
    const m = mockFetch([
      ['glm.test', (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        auth = (init?.headers as Record<string, string>).authorization;
        const step = script[Math.min(i++, script.length - 1)];
        return { choices: [{ finish_reason: step.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: step.content ?? '', tool_calls: step.tool_calls } }] };
      }],
    ]);
    const app = createApp({ fetcher: m.fetch });
    const env = makeEnv({ GLM_API_KEY: 'sk-test' });
    const events = parseSse(await (await investigate(app, env, { scenarioId: 's3' })).text());
    const report = events.find((e) => e.type === 'report') as Extract<AgentEvent, { type: 'report' }>;
    const analysis = events.find((e) => e.type === 'analysis') as Extract<AgentEvent, { type: 'analysis' }>;
    expect(report.source).toBe('glm');
    expect(report.model).toBe('glm-test');
    expect(report.guard.scoreFixed).toBe(true);
    expect(report.guard.unverifiedRefs).toBe(1);
    expect(report.markdown).toContain(`風險分數：${analysis.score}`);
    expect(report.markdown).toContain('〔未驗證〕');
    expect(report.markdown).toContain('系統計算之風險評分卡');
    expect(events.filter((e) => e.type === 'tool_result').length).toBe(3);
    expect(auth).toBe('Bearer sk-test');
    expect(bodies[0].model).toBe('glm-test');
    expect((bodies[0].tools as unknown[]).length).toBe(5);
    expect(bodies[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'c1' })]));
  });

  it('falls back to the template when GLM returns 401', async () => {
    const m = mockFetch([['glm.test', () => json({ error: { message: 'invalid key' } }, 401)]]);
    const app = createApp({ fetcher: m.fetch });
    const events = parseSse(await (await investigate(app, makeEnv({ GLM_API_KEY: 'bad' }), { scenarioId: 's6' })).text());
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'LLM_UNAVAILABLE', recoverable: true });
    expect((events.find((e) => e.type === 'report') as Extract<AgentEvent, { type: 'report' }>).source).toBe('template');
  });

  it('enforces the per-IP daily quota before streaming', async () => {
    const app = createApp({ fetcher: mockFetch([]).fetch });
    const env = makeEnv({ AGENT_DAILY_PER_IP: '1' });
    await (await investigate(app, env, { scenarioId: 's9' })).text();
    const res = await investigate(app, env, { scenarioId: 's9' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects invalid live addresses with JSON before streaming', async () => {
    const res = await investigate(createApp(), makeEnv(), { chain: 'eth', address: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('cron jobs', () => {
  const now = Math.floor(Date.now() / 1000);
  const depositInput = `0x13d98d13${'0'.repeat(256)}`;
  const recipient = '00000000000000000000000012345678901234567890123456789012345678ab'.slice(0, 64);
  const withdrawInput = `0xb438689f${'0'.repeat(64 * 4)}${'0'.repeat(24)}abcdefabcdefabcdefabcdefabcdefabcdefabcd${'0'.repeat(64 * 3)}`;
  void recipient;

  function sweepRoutes(): [string | RegExp, Handler][] {
    return [
      ['coingecko', () => ({ ethereum: { usd: 2500 }, binancecoin: { usd: 600 }, tron: { usd: 0.3 }, bitcoin: { usd: 80000 } })],
      ['address=0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', () => ({
        status: '1',
        result: [
          { hash: `0x${'a'.repeat(64)}`, timeStamp: String(now - 60), blockNumber: '100', from: '0x1111111111111111111111111111111111111111', to: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', value: '1000000000000000000', isError: '0', methodId: '0x13d98d13', input: depositInput },
          { hash: `0x${'b'.repeat(64)}`, timeStamp: String(now - 30), blockNumber: '101', from: '0x2222222222222222222222222222222222222222', to: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', value: '0', isError: '0', methodId: '0xb438689f', input: withdrawInput },
        ],
      })],
      ['address=0x0330070fd38ec3bb94f58fa55d40368271e9e54a', () => ({ status: '1', result: [{ hash: `0x${'c'.repeat(64)}`, timeStamp: String(now - 100), blockNumber: '99', from: '0x3333333333333333333333333333333333333333', to: '0x0330070fd38ec3bb94f58fa55d40368271e9e54a', value: '5000000000000000000', isError: '0' }] })],
      ['eth.blockscout.com', () => ({ status: '0', message: 'No transactions found', result: [] })],
      ['api.trongrid.io', () => ({ data: [] })],
    ];
  }

  it('decodes the Tornado withdraw recipient', () => {
    expect(tornadoRecipient(withdrawInput)).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(tornadoRecipient(depositInput.slice(0, 20))).toBeNull();
  });

  it('sweep inserts Tornado and OFAC alerts once and advances cursors', async () => {
    const env = makeEnv();
    const m = mockFetch(sweepRoutes());
    const stats = await ethSweep(env, new SubrequestBudget(45, m.fetch));
    expect(stats.tornado).toBe(2);
    expect(stats.ofacEth).toBeGreaterThanOrEqual(1);
    expect(m.calls.length).toBeLessThanOrEqual(8);
    const app = createApp();
    const alerts = (await (await app.request('/api/alerts?limit=100', {}, env)).json()) as { items: { title: string; address: string; source: string }[] };
    expect(alerts.items.some((a) => a.title.includes('存入') && a.address === '0x1111111111111111111111111111111111111111')).toBe(true);
    expect(alerts.items.some((a) => a.title.includes('提領') && a.address === '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(true);
    const count = alerts.items.length;
    await ethSweep(env, new SubrequestBudget(45, mockFetch(sweepRoutes()).fetch));
    const again = (await (await app.request('/api/alerts?limit=100', {}, env)).json()) as { items: unknown[] };
    expect(again.items.length).toBe(count);
    const stats2 = (await (await app.request('/api/stats', {}, env)).json()) as { alerts24h: { total: number }; lastSweepAt: number | null };
    expect(stats2.alerts24h.total).toBe(count);
    expect(stats2.lastSweepAt).not.toBeNull();
  });

  it('watchlist scan updates score and level', async () => {
    const env = makeEnv();
    const app = createApp();
    await app.request('/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'eth', address: RONIN }) }, env);
    const m = mockFetch(ethRoutes());
    const stats = await watchlistScan(env, new SubrequestBudget(45, m.fetch));
    expect(stats.scanned).toBe(1);
    const list = (await (await app.request('/api/watchlist', {}, env)).json()) as { items: { lastScore: number; lastLevel: string }[] };
    expect(list.items[0].lastScore).toBe(100);
    expect(list.items[0].lastLevel).toBe('critical');
  });
});

describe('Blockscout compact URL for cron', () => {
  it('switches to the PRO Etherscan-compatible endpoint when keyed', async () => {
    const { blockscoutCompactUrl } = await import('../src/cron');
    expect(blockscoutCompactUrl({} as Env, 'module=account&action=txlist&address=0x1')).toBe(
      'https://eth.blockscout.com/api?module=account&action=txlist&address=0x1',
    );
    expect(blockscoutCompactUrl({ BLOCKSCOUT_API_KEY: 'k' } as Env, 'module=account&action=txlist&address=0x1')).toBe(
      'https://api.blockscout.com/v2/api?chain_id=1&module=account&action=txlist&address=0x1&apikey=k',
    );
  });
});

describe('/api/analyze via Zerion', () => {
  const S = '0x5000000000000000000000000000000000000005';
  const routes = (): [string | RegExp, Handler][] => [
    ['coingecko', () => ({ ethereum: { usd: 2500 }, binancecoin: { usd: 600 }, tron: { usd: 0.3 }, bitcoin: { usd: 80000 } })],
    ['/positions/', () => fixture('zerion-positions.json')],
    ['/transactions/', () => fixture('zerion-transactions.json')],
  ];

  it('analyzes ETH through Zerion and counts two requests against the daily allowance', async () => {
    const env = makeEnv({ ZERION_API_KEY: 'zk' });
    const m = mockFetch(routes());
    const res = await createApp({ fetcher: m.fetch }).request(`/api/analyze?chain=eth&address=${S}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: { id: string }[]; dataQuality: { sources: string[] } };
    expect(body.dataQuality.sources[0]).toContain('Zerion');
    expect(body.hits.map((h) => h.id)).toContain('R04');
    expect(m.calls.some((c) => c.url.includes('blockscout'))).toBe(false);
    const q = await env.DB.prepare("SELECT count FROM quotas WHERE key = 'zerion-req'").first<{ count: number }>();
    expect(q?.count).toBe(2);
  });

  it('returns 503 once the daily Zerion allowance is used up', async () => {
    const env = makeEnv({ ZERION_API_KEY: 'zk', ZERION_DAILY_REQUESTS: '10' });
    const start = Math.floor(Date.now() / 1000 / 86400) * 86400;
    await env.DB.prepare('INSERT INTO quotas (key, count, window_start) VALUES (?, ?, ?)').bind('zerion-req', 10, start).run();
    const res = await createApp({ fetcher: mockFetch(routes()).fetch }).request(`/api/analyze?chain=bsc&address=${S}`, {}, env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CHAIN_UNAVAILABLE');
  });
});

describe('ETH fallback when Zerion cannot track an address', () => {
  it('falls back to Blockscout for ETH and explains the failure for BSC', async () => {
    const untrackable = () => new Response(JSON.stringify({ errors: [{ title: 'Malformed parameter was sent', detail: 'untrackable wallet address' }] }), { status: 400 });
    const routes = (): [string | RegExp, Handler][] => [
      ['coingecko', () => ({ ethereum: { usd: 2500 }, binancecoin: { usd: 600 }, tron: { usd: 0.3 }, bitcoin: { usd: 80000 } })],
      ['api.zerion.io', untrackable],
      ['/internal-transactions', () => ({ items: [], next_page_params: null })],
      ['/token-transfers', () => fixture('bs-tokentransfers-ronin.json')],
      ['/transactions', () => fixture('bs-v2-transactions-ronin.json')],
      ['/counters', () => fixture('bs-counters-ronin.json')],
      ['/api/v2/addresses/', () => fixture('bs-address-ronin.json')],
    ];
    const env = makeEnv({ ZERION_API_KEY: 'zk' });
    const eth = await createApp({ fetcher: mockFetch(routes()).fetch }).request(`/api/analyze?chain=eth&address=${RONIN}`, {}, env);
    expect(eth.status).toBe(200);
    const body = (await eth.json()) as { score: number; dataQuality: { sources: string[]; notes: string[] } };
    expect(body.score).toBe(100);
    expect(body.dataQuality.sources.join()).toContain('Blockscout');
    expect(body.dataQuality.notes.join()).toContain('Zerion');
    const bsc = await createApp({ fetcher: mockFetch(routes()).fetch }).request(`/api/analyze?chain=bsc&address=${RONIN}`, {}, env);
    expect(bsc.status).toBe(422);
    expect(((await bsc.json()) as { error: { message: string } }).error.message).toContain('Zerion');
  });
});
