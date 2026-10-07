import type {
  AdminClient,
  AdminClientsResponse,
  AdminJobInfo,
  AdminJobName,
  AdminJobRunResponse,
  AdminOverview,
} from '@aml/engine';
import type { Hono } from 'hono';
import { z } from 'zod';
import { chainStatus } from '../adapters';
import { CRONS, executeJob, lastJobRun } from '../cron';
import { type Env, intVar, nowSec } from '../env';
import { ApiError } from '../lib/errors';
import type { SubrequestBudget } from '../lib/http';
import { peekQuota } from '../lib/store';
import { enforceRateLimit, requireAdmin } from '../middleware';
import { getSanctions } from '../sanctions/store';
import { ZERION_QUOTA_KEY, zerionDailyLimit } from '../services/investigator';

const JOBS: { job: AdminJobName; schedule: string }[] = [
  { job: 'sweep', schedule: CRONS.sweep },
  { job: 'watchlist', schedule: CRONS.watchlist },
  { job: 'sanctions', schedule: CRONS.daily },
];

const ClientId = z.string().regex(/^[0-9a-f]{16}$/, '無效的用戶 ID');

const dayStart = () => Math.floor(nowSec() / 86400) * 86400;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function registerAdminRoutes(app: Hono<{ Bindings: Env }>, newBudget: () => SubrequestBudget): void {
  app.use('/api/admin/*', async (c, next) => {
    await enforceRateLimit(c, 'RL_API');
    await requireAdmin(c);
    await next();
  });

  app.get('/api/admin/verify', (c) => c.json({ ok: true }));

  app.get('/api/admin/overview', async (c) => {
    const env = c.env;
    const db = env.DB;
    const since24h = nowSec() - 86400;
    const today = dayStart();
    const [zerionUsed, glmUsed, counts, bySource, jobs, sanctions] = await Promise.all([
      peekQuota(env, ZERION_QUOTA_KEY),
      peekQuota(env, 'glm-global'),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM alerts) AS alerts,
             (SELECT COUNT(*) FROM alerts WHERE created_at >= ?1) AS alerts24h,
             (SELECT COUNT(*) FROM watchlist) AS watchlist,
             (SELECT COUNT(*) FROM investigations) AS investigations,
             (SELECT COUNT(*) FROM investigations WHERE created_at >= ?2) AS investigationsToday,
             (SELECT COUNT(*) FROM analysis_cache WHERE expires_at >= ?3) AS cacheEntries,
             (SELECT COUNT(*) FROM blocked_clients) AS blockedClients`,
        )
        .bind(since24h, today, nowSec())
        .first<Record<string, number>>(),
      db.prepare('SELECT source, COUNT(*) AS n FROM investigations GROUP BY source').all<{ source: string; n: number }>(),
      Promise.all(JOBS.map(async (j) => ({ ...j, run: await lastJobRun(env, j.job) }))),
      getSanctions(env),
    ]);
    const source = Object.fromEntries(bySource.results.map((r) => [r.source, r.n]));
    const body: AdminOverview = {
      generatedAt: nowSec(),
      usage: {
        zerion: { used: zerionUsed, limit: zerionDailyLimit(env) },
        glm: { used: glmUsed, limit: intVar(env.GLM_DAILY_GLOBAL, 300) },
        agentPerIpLimit: intVar(env.AGENT_DAILY_PER_IP, 15),
        watchlistPerIpLimit: intVar(env.WATCHLIST_DAILY_PER_IP, 3),
      },
      counts: {
        alerts: counts?.alerts ?? 0,
        alerts24h: counts?.alerts24h ?? 0,
        watchlist: counts?.watchlist ?? 0,
        watchlistMax: intVar(env.WATCHLIST_MAX, 30),
        investigations: counts?.investigations ?? 0,
        investigationsToday: counts?.investigationsToday ?? 0,
        investigationsBySource: { glm: source.glm ?? 0, template: source.template ?? 0 },
        cacheEntries: counts?.cacheEntries ?? 0,
        blockedClients: counts?.blockedClients ?? 0,
      },
      jobs: jobs.map(
        (j): AdminJobInfo => ({
          job: j.job,
          schedule: j.schedule,
          lastRunAt: j.run?.at ?? null,
          ok: j.run ? j.run.ok : null,
          durationMs: j.run?.durationMs ?? null,
          stats: j.run?.stats ?? null,
          error: j.run?.error,
        }),
      ),
      sanctions: { updatedAt: sanctions.updatedAt, counts: sanctions.counts() },
      config: {
        glmConfigured: Boolean(env.GLM_API_KEY),
        glmModel: env.GLM_MODEL,
        glmHost: hostOf(env.GLM_BASE_URL),
        glmThinking: env.GLM_THINKING ?? 'disabled',
        zerionConfigured: Boolean(env.ZERION_API_KEY),
        blockscoutKey: Boolean(env.BLOCKSCOUT_API_KEY),
        trongridKey: Boolean(env.TRONGRID_API_KEY),
        allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      },
      chains: chainStatus(env),
    };
    return c.json(body);
  });

  app.post('/api/admin/run/:job', async (c) => {
    const job = z.enum(['sweep', 'watchlist', 'sanctions']).parse(c.req.param('job')) as AdminJobName;
    const run = await executeJob(job, c.env, newBudget());
    const body: AdminJobRunResponse = { ok: run.ok, job, stats: run.stats, durationMs: run.durationMs, error: run.error };
    return c.json(body);
  });

  app.get('/api/admin/clients', async (c) => {
    const db = c.env.DB;
    const today = dayStart();
    const [quotas, investigations, blocked] = await Promise.all([
      db
        .prepare("SELECT key, count FROM quotas WHERE window_start = ? AND (key LIKE 'agent:%' OR key LIKE 'watch:%')")
        .bind(today)
        .all<{ key: string; count: number }>(),
      db
        .prepare(
          'SELECT ip_hash, COUNT(*) AS n, MAX(created_at) AS last FROM investigations WHERE created_at >= ? AND ip_hash IS NOT NULL GROUP BY ip_hash',
        )
        .bind(today)
        .all<{ ip_hash: string; n: number; last: number }>(),
      db.prepare('SELECT ip_hash, reason, created_at FROM blocked_clients').all<{ ip_hash: string; reason: string; created_at: number }>(),
    ]);
    const clients = new Map<string, AdminClient>();
    const get = (id: string) => {
      let row = clients.get(id);
      if (!row) {
        row = { id, agentRuns: 0, watchAdds: 0, investigationsToday: 0, lastSeenAt: null, blocked: false };
        clients.set(id, row);
      }
      return row;
    };
    for (const q of quotas.results) {
      const [kind, id] = q.key.split(':');
      if (kind === 'agent') get(id).agentRuns = q.count;
      else if (kind === 'watch') get(id).watchAdds = q.count;
    }
    for (const r of investigations.results) {
      const row = get(r.ip_hash);
      row.investigationsToday = r.n;
      row.lastSeenAt = r.last;
    }
    for (const b of blocked.results) {
      const row = get(b.ip_hash);
      row.blocked = true;
      row.blockedReason = b.reason || undefined;
      row.blockedAt = b.created_at;
    }
    const items = [...clients.values()].sort(
      (a, b) => Number(b.blocked) - Number(a.blocked) || b.agentRuns - a.agentRuns || b.investigationsToday - a.investigationsToday,
    );
    const body: AdminClientsResponse = {
      date: new Date(today * 1000).toISOString().slice(0, 10),
      agentPerIpLimit: intVar(c.env.AGENT_DAILY_PER_IP, 15),
      watchlistPerIpLimit: intVar(c.env.WATCHLIST_DAILY_PER_IP, 3),
      items,
    };
    return c.json(body);
  });

  const clientId = (raw: string) => {
    const parsed = ClientId.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', '無效的用戶 ID。');
    return parsed.data;
  };

  app.post('/api/admin/clients/:id/reset', async (c) => {
    const id = clientId(c.req.param('id'));
    await c.env.DB.prepare('DELETE FROM quotas WHERE key IN (?, ?)').bind(`agent:${id}`, `watch:${id}`).run();
    return c.json({ ok: true });
  });

  app.post('/api/admin/clients/:id/block', async (c) => {
    const id = clientId(c.req.param('id'));
    const body = z.object({ reason: z.string().max(80).default('') }).parse(await c.req.json().catch(() => ({})));
    const reason = body.reason.replace(/[<>\u0000-\u001f]/g, '').trim();
    await c.env.DB.prepare(
      'INSERT INTO blocked_clients (ip_hash, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET reason = excluded.reason',
    )
      .bind(id, reason, nowSec())
      .run();
    return c.json({ ok: true });
  });

  app.delete('/api/admin/clients/:id/block', async (c) => {
    const id = clientId(c.req.param('id'));
    await c.env.DB.prepare('DELETE FROM blocked_clients WHERE ip_hash = ?').bind(id).run();
    return c.json({ ok: true });
  });
}
