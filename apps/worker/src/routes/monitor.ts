import {
  type Alert,
  type AlertsResponse,
  type AnalysisResult,
  CHAINS,
  type Chain,
  type InvestigationDetail,
  type InvestigationListResponse,
  type InvestigationSummary,
  isValidAddress,
  normalizeAddress,
  type RiskLevel,
  type Severity,
  type StatsResponse,
  type WatchlistItem,
  type WatchlistResponse,
} from '@aml/engine';
import type { Hono } from 'hono';
import { z } from 'zod';
import { type Env, intVar, nowSec } from '../env';
import { ApiError } from '../lib/errors';
import { consumeQuota, getCursor } from '../lib/store';
import { enforceNotBlocked, enforceRateLimit, requireAdmin } from '../middleware';
import { getSanctions } from '../sanctions/store';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

interface AlertRow {
  id: number;
  chain: Chain;
  address: string;
  source: Alert['source'];
  rule_id: string;
  severity: Severity;
  title: string;
  detail: string;
  tx_hash: string;
  counterparty: string | null;
  usd: number | null;
  created_at: number;
}

function toAlert(r: AlertRow): Alert {
  return {
    id: r.id,
    chain: r.chain,
    address: r.address,
    source: r.source,
    ruleId: r.rule_id,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    txHash: /^(0x)?[0-9a-fA-F]{64}$/.test(r.tx_hash) ? r.tx_hash : undefined,
    counterparty: r.counterparty ?? undefined,
    usd: r.usd ?? undefined,
    createdAt: r.created_at,
  };
}

interface WatchRow {
  id: number;
  chain: Chain;
  address: string;
  label: string;
  created_at: number;
  last_scanned_at: number | null;
  last_score: number | null;
  last_level: RiskLevel | null;
}

function toWatch(r: WatchRow): WatchlistItem {
  return {
    id: r.id,
    chain: r.chain,
    address: r.address,
    label: r.label,
    createdAt: r.created_at,
    lastScannedAt: r.last_scanned_at,
    lastScore: r.last_score,
    lastLevel: r.last_level,
  };
}

interface InvestigationRow {
  id: string;
  chain: Chain;
  address: string;
  mode: 'live' | 'scenario';
  scenario_id: string | null;
  score: number;
  level: RiskLevel;
  source: 'glm' | 'template';
  model: string | null;
  created_at: number;
  hits_json?: string;
  report_md?: string;
  trace_json?: string;
}

function toSummary(r: InvestigationRow): InvestigationSummary {
  return {
    id: r.id,
    chain: r.chain,
    address: r.address,
    mode: r.mode,
    scenarioId: r.scenario_id ?? undefined,
    score: r.score,
    level: r.level,
    source: r.source,
    model: r.model ?? undefined,
    createdAt: r.created_at,
  };
}

export function registerMonitorRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/alerts', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        chain: z.enum(CHAINS as [string, ...string[]]).optional(),
        severity: z.enum(SEVERITIES as [string, ...string[]]).optional(),
        since: z.coerce.number().int().optional(),
      })
      .parse(c.req.query());
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.chain) (where.push('chain = ?'), args.push(q.chain));
    if (q.severity) (where.push('severity = ?'), args.push(q.severity));
    if (q.since) (where.push('created_at > ?'), args.push(q.since));
    const sql = `SELECT * FROM alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`;
    const rows = (await c.env.DB.prepare(sql).bind(...args, q.limit).all<AlertRow>()).results;
    return c.json({ items: rows.map(toAlert) } satisfies AlertsResponse);
  });

  app.get('/api/stats', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const now = nowSec();
    const since = now - 86400;
    const hourStart = Math.floor(now / 3600) * 3600 - 23 * 3600;
    const db = c.env.DB;
    const [bySevChain, hourly, dist, invCount, watchCount, last] = await Promise.all([
      db.prepare('SELECT severity, chain, COUNT(*) AS n FROM alerts WHERE created_at >= ? GROUP BY severity, chain').bind(since).all<{ severity: Severity; chain: Chain; n: number }>(),
      db.prepare('SELECT (created_at / 3600) * 3600 AS h, COUNT(*) AS n FROM alerts WHERE created_at >= ? GROUP BY h').bind(hourStart).all<{ h: number; n: number }>(),
      db.prepare(
        `SELECT level, COUNT(*) AS n FROM (SELECT level FROM investigations UNION ALL SELECT last_level AS level FROM watchlist WHERE last_level IS NOT NULL) GROUP BY level`,
      ).all<{ level: RiskLevel; n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM investigations').first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM watchlist').first<{ n: number }>(),
      getCursor(c.env, 'sweep:last'),
    ]);
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
    const byChain = Object.fromEntries(CHAINS.map((ch) => [ch, 0])) as Record<Chain, number>;
    let total = 0;
    for (const r of bySevChain.results) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
      byChain[r.chain] = (byChain[r.chain] ?? 0) + r.n;
      total += r.n;
    }
    const hourMap = new Map(hourly.results.map((r) => [r.h, r.n]));
    const alertsHourly = Array.from({ length: 24 }, (_, i) => {
      const hour = hourStart + i * 3600;
      return { hour, count: hourMap.get(hour) ?? 0 };
    });
    const riskDistribution = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<RiskLevel, number>;
    for (const r of dist.results) if (r.level in riskDistribution) riskDistribution[r.level] = r.n;
    const sanctions = await getSanctions(c.env);
    const body: StatsResponse = {
      alerts24h: { total, bySeverity, byChain },
      alertsHourly,
      riskDistribution,
      investigations: invCount?.n ?? 0,
      watchlistCount: watchCount?.n ?? 0,
      sanctions: { updatedAt: sanctions.updatedAt, counts: sanctions.counts() },
      lastSweepAt: last ? Number(last) : null,
    };
    return c.json(body);
  });

  app.get('/api/watchlist', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const rows = (await c.env.DB.prepare('SELECT * FROM watchlist ORDER BY created_at DESC').all<WatchRow>()).results;
    return c.json({ items: rows.map(toWatch), max: intVar(c.env.WATCHLIST_MAX, 30) } satisfies WatchlistResponse);
  });

  app.post('/api/watchlist', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const hash = await enforceNotBlocked(c);
    const body = z
      .object({ chain: z.enum(CHAINS as [string, ...string[]]), address: z.string().min(1).max(120), label: z.string().max(40).default('') })
      .parse(await c.req.json().catch(() => ({})));
    const chain = body.chain as Chain;
    const address = body.address.trim();
    if (!isValidAddress(chain, address)) throw new ApiError(400, 'INVALID_ADDRESS', '地址格式不正確。');
    if (chain === 'bsc' && !c.env.ZERION_API_KEY) throw new ApiError(503, 'CHAIN_UNAVAILABLE', 'BSC 監控未啟用（缺少 Zerion 金鑰）。');
    const stored = normalizeAddress(chain, address);
    const existing = await c.env.DB.prepare('SELECT * FROM watchlist WHERE chain = ? AND address = ?').bind(chain, stored).first<WatchRow>();
    if (existing) return c.json(toWatch(existing));
    const counts = await c.env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN chain = 'bsc' THEN 1 ELSE 0 END) AS bsc FROM watchlist",
    ).first<{ total: number; bsc: number | null }>();
    const max = intVar(c.env.WATCHLIST_MAX, 30);
    if ((counts?.total ?? 0) >= max) throw new ApiError(429, 'QUOTA_EXCEEDED', `監控名單已滿（上限 ${max} 筆）。`);
    if (chain === 'bsc' && (counts?.bsc ?? 0) >= intVar(c.env.WATCHLIST_MAX_BSC, 5)) {
      throw new ApiError(429, 'QUOTA_EXCEEDED', 'BSC 監控名額已滿。');
    }
    const quota = await consumeQuota(c.env, `watch:${hash}`, intVar(c.env.WATCHLIST_DAILY_PER_IP, 3));
    if (!quota.allowed) throw new ApiError(429, 'QUOTA_EXCEEDED', '今日新增監控地址次數已達上限。', 3600);
    const label = body.label.replace(/[<>\u0000-\u001f]/g, '').trim();
    const row = await c.env.DB.prepare(
      'INSERT INTO watchlist (chain, address, label, created_at, created_ip) VALUES (?, ?, ?, ?, ?) RETURNING *',
    )
      .bind(chain, stored, label, nowSec(), hash)
      .first<WatchRow>();
    return c.json(toWatch(row!), 201);
  });

  app.delete('/api/watchlist/:id', async (c) => {
    await requireAdmin(c);
    await c.env.DB.prepare('DELETE FROM watchlist WHERE id = ?').bind(Number(c.req.param('id'))).run();
    return c.json({ ok: true });
  });

  app.get('/api/investigations', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(c.req.query('limit'));
    const rows = (
      await c.env.DB.prepare(
        'SELECT id, chain, address, mode, scenario_id, score, level, source, model, created_at FROM investigations ORDER BY created_at DESC LIMIT ?',
      )
        .bind(limit)
        .all<InvestigationRow>()
    ).results;
    return c.json({ items: rows.map(toSummary) } satisfies InvestigationListResponse);
  });

  app.get('/api/investigations/:id', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const row = await c.env.DB.prepare('SELECT * FROM investigations WHERE id = ?').bind(c.req.param('id')).first<InvestigationRow>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', '找不到此調查報告。');
    const body: InvestigationDetail = {
      ...toSummary(row),
      reportMd: row.report_md ?? '',
      hits: JSON.parse(row.hits_json ?? '[]'),
      trace: JSON.parse(row.trace_json ?? '[]'),
    };
    return c.json(body);
  });
}

export type { AnalysisResult };
