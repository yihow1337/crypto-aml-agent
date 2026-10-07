import type { AdminClientsResponse, AdminOverview } from '@aml/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { resetSanctionsMemo } from '../src/sanctions/store';
import { createTestD1 } from './helpers/d1-sqlite';
import { mockFetch } from './helpers/fetch-mock';

const TOKEN = 'admin-secret-token-0123456789';

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createTestD1(),
    GLM_BASE_URL: 'https://glm.test/api/paas/v4',
    GLM_MODEL: 'glm-test',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    ADMIN_TOKEN: TOKEN,
    ...extra,
  };
}

const admin = { 'x-admin-token': TOKEN };

beforeEach(() => resetSanctionsMemo());

describe('admin authentication', () => {
  it('rejects missing or wrong tokens and accepts the right one', async () => {
    const app = createApp();
    const env = makeEnv();
    expect((await app.request('/api/admin/verify', {}, env)).status).toBe(403);
    expect((await app.request('/api/admin/verify', { headers: { 'x-admin-token': 'nope' } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/verify', { headers: { 'x-admin-token': `${TOKEN}x` } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/verify', { headers: admin }, env)).status).toBe(200);
  });

  it('is disabled when no ADMIN_TOKEN is configured', async () => {
    const res = await createApp().request('/api/admin/verify', { headers: { 'x-admin-token': '' } }, makeEnv({ ADMIN_TOKEN: undefined }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/overview', () => {
  it('reports usage, counts, job runs and configuration', async () => {
    const env = makeEnv({ ZERION_API_KEY: 'zk', ZERION_DAILY_REQUESTS: '1800', GLM_API_KEY: 'g', GLM_DAILY_GLOBAL: '300' });
    const start = Math.floor(Date.now() / 1000 / 86400) * 86400;
    await env.DB.prepare('INSERT INTO quotas (key, count, window_start) VALUES (?, ?, ?), (?, ?, ?)')
      .bind('zerion-req', 42, start, 'glm-global', 7, start)
      .run();
    const app = createApp({ fetcher: mockFetch([['raw.githubusercontent.com', () => new Response('0x1111111111111111111111111111111111111111\n')]]).fetch });
    const run = await app.request('/api/admin/run/sanctions', { method: 'POST', headers: admin }, env);
    expect(run.status).toBe(200);
    expect(((await run.json()) as { ok: boolean }).ok).toBe(true);

    const res = await app.request('/api/admin/overview', { headers: admin }, env);
    expect(res.status).toBe(200);
    const o = (await res.json()) as AdminOverview;
    expect(o.usage.zerion).toEqual({ used: 42, limit: 1800 });
    expect(o.usage.glm).toEqual({ used: 7, limit: 300 });
    expect(o.config.glmModel).toBe('glm-test');
    expect(o.config.zerionConfigured).toBe(true);
    expect(JSON.stringify(o)).not.toContain('zk');
    const sanctionsJob = o.jobs.find((j) => j.job === 'sanctions')!;
    expect(sanctionsJob.ok).toBe(true);
    expect(sanctionsJob.lastRunAt).toBeGreaterThan(0);
    expect(o.jobs.map((j) => j.job)).toEqual(['sweep', 'watchlist', 'sanctions']);
    expect(o.counts.blockedClients).toBe(0);
  });
});

describe('abuse monitoring', () => {
  const investigate = (app: ReturnType<typeof createApp>, env: Env, ip: string) =>
    app.request(
      '/api/agent/investigate',
      { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ scenarioId: 's9' }) },
      env,
    );

  it('lists clients by anonymous id, and supports block, unblock and reset', async () => {
    const app = createApp({ fetcher: mockFetch([]).fetch });
    const env = makeEnv();
    await (await investigate(app, env, '1.2.3.4')).text();
    await (await investigate(app, env, '1.2.3.4')).text();
    await (await investigate(app, env, '5.6.7.8')).text();

    const list = (await (await app.request('/api/admin/clients', { headers: admin }, env)).json()) as AdminClientsResponse;
    expect(list.items).toHaveLength(2);
    const heavy = list.items[0];
    expect(heavy.agentRuns).toBe(2);
    expect(heavy.investigationsToday).toBe(2);
    expect(heavy.id).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(list)).not.toContain('1.2.3.4');

    const block = await app.request(`/api/admin/clients/${heavy.id}/block`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ reason: '測試' }) }, env);
    expect(block.status).toBe(200);
    const blocked = await investigate(app, env, '1.2.3.4');
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { message: string } }).error.message).toContain('封鎖');
    expect((await app.request('/api/analyze?chain=eth&address=0x0000000000000000000000000000000000000001', { headers: { 'cf-connecting-ip': '1.2.3.4' } }, env)).status).toBe(403);
    expect((await investigate(app, env, '5.6.7.8')).status).toBe(200);

    const after = (await (await app.request('/api/admin/clients', { headers: admin }, env)).json()) as AdminClientsResponse;
    expect(after.items.find((c) => c.id === heavy.id)?.blocked).toBe(true);

    expect((await app.request(`/api/admin/clients/${heavy.id}/block`, { method: 'DELETE', headers: admin }, env)).status).toBe(200);
    expect((await app.request(`/api/admin/clients/${heavy.id}/reset`, { method: 'POST', headers: admin }, env)).status).toBe(200);
    const reset = (await (await app.request('/api/admin/clients', { headers: admin }, env)).json()) as AdminClientsResponse;
    const row = reset.items.find((c) => c.id === heavy.id)!;
    expect(row.blocked).toBe(false);
    expect(row.agentRuns).toBe(0);
    expect((await investigate(app, env, '1.2.3.4')).status).toBe(200);
  });

  it('rejects malformed client ids', async () => {
    const res = await createApp().request('/api/admin/clients/not-a-hash/block', { method: 'POST', headers: admin }, makeEnv());
    expect(res.status).toBe(400);
  });
});

describe('block list resilience', () => {
  it('keeps serving requests if the block list table is unavailable', async () => {
    const env = makeEnv();
    await env.DB.prepare('DROP TABLE blocked_clients').run();
    const res = await createApp().request('/api/scenarios/s1', {}, env);
    expect(res.status).toBe(200);
    const agent = await createApp({ fetcher: mockFetch([]).fetch }).request(
      '/api/agent/investigate',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 's9' }) },
      env,
    );
    expect(agent.status).toBe(200);
  });
});
