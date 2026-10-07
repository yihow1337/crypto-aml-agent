import {
  type AnalysisResult,
  type AnalyzeResponse,
  buildScenario,
  CHAINS,
  type DetectResponse,
  detectChains,
  type HealthResponse,
  normalizeAddress,
  SCENARIOS,
  type ScenarioListResponse,
} from '@aml/engine';
import type { Hono } from 'hono';
import { z } from 'zod';
import { chainStatus } from '../adapters';
import { type Env, VERSION } from '../env';
import { ApiError } from '../lib/errors';
import type { SubrequestBudget } from '../lib/http';
import { cacheGet, cachePut, getCursor } from '../lib/store';
import { enforceNotBlocked, enforceRateLimit } from '../middleware';
import { getSanctions } from '../sanctions/store';
import { Investigator } from '../services/investigator';

export const ANALYSIS_TTL = 600;
const ChainSchema = z.enum(CHAINS as [string, ...string[]]);

export function analysisKey(chain: string, address: string): string {
  return `analysis:${chain}:${normalizeAddress(chain as never, address.trim())}`;
}

export function registerCoreRoutes(app: Hono<{ Bindings: Env }>, newBudget: () => SubrequestBudget): void {
  app.get('/api/health', async (c) => {
    const sanctions = await getSanctions(c.env);
    const last = await getCursor(c.env, 'sweep:last');
    let host = '';
    try {
      host = new URL(c.env.GLM_BASE_URL).host;
    } catch {
      host = '';
    }
    const body: HealthResponse = {
      ok: true,
      version: VERSION,
      glm: { configured: Boolean(c.env.GLM_API_KEY), model: c.env.GLM_MODEL, host },
      sanctions: { updatedAt: sanctions.updatedAt, counts: sanctions.counts() },
      chains: chainStatus(c.env),
      lastSweepAt: last ? Number(last) : null,
    };
    return c.json(body);
  });

  app.get('/api/detect', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    const address = c.req.query('address') ?? '';
    const candidates = detectChains(address);
    const body: DetectResponse = { valid: candidates.length > 0, candidates };
    return c.json(body);
  });

  app.get('/api/analyze', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    await enforceNotBlocked(c);
    const chain = ChainSchema.parse(c.req.query('chain')) as AnalysisResult['subject']['chain'];
    const address = (c.req.query('address') ?? '').trim();
    const key = analysisKey(chain, address);
    const fresh = c.req.query('fresh') === '1';
    if (!fresh) {
      const cached = await cacheGet<AnalysisResult>(c.env, key);
      if (cached) return c.json({ ...cached, cached: true, mode: 'live' } satisfies AnalyzeResponse);
    }
    const inv = new Investigator({ env: c.env, budget: newBudget(), chain, address });
    const result = await inv.analyze();
    await inv.flushUsage();
    await cachePut(c.env, key, result, ANALYSIS_TTL);
    return c.json({ ...result, cached: false, mode: 'live' } satisfies AnalyzeResponse);
  });

  app.post('/api/trace', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    await enforceNotBlocked(c);
    const body = z
      .object({ chain: ChainSchema, address: z.string().min(1).max(120), topN: z.number().int().min(1).max(5).optional() })
      .parse(await c.req.json());
    const chain = body.chain as AnalysisResult['subject']['chain'];
    const inv = new Investigator({ env: c.env, budget: newBudget(), chain, address: body.address });
    const cached = await cacheGet<AnalysisResult>(c.env, analysisKey(chain, body.address));
    if (cached) inv.seed(cached);
    const { after } = await inv.trace(body.topN ?? 5);
    await inv.flushUsage();
    await cachePut(c.env, analysisKey(chain, body.address), after, ANALYSIS_TTL);
    return c.json({ ...after, cached: false, mode: 'live' } satisfies AnalyzeResponse);
  });

  app.get('/api/scenarios', (c) => c.json({ items: SCENARIOS } satisfies ScenarioListResponse));

  app.get('/api/scenarios/:id', async (c) => {
    const scenario = buildScenario(c.req.param('id'));
    if (!scenario) throw new ApiError(404, 'NOT_FOUND', '找不到此情境。');
    const inv = Investigator.forScenario(c.env, newBudget(), scenario);
    const result = await inv.analyze();
    return c.json({ ...result, cached: false, mode: 'scenario', scenario: scenario.meta } satisfies AnalyzeResponse);
  });

  app.get('/api/sanctions/check', async (c) => {
    const chain = ChainSchema.parse(c.req.query('chain')) as AnalysisResult['subject']['chain'];
    const address = (c.req.query('address') ?? '').trim();
    const sanctions = await getSanctions(c.env);
    return c.json({ chain, address, sanctioned: sanctions.has(chain, address), updatedAt: sanctions.updatedAt });
  });
}
