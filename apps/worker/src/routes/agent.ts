import { type AgentEvent, type AnalysisResult, buildScenario, CHAINS, type ScenarioMeta } from '@aml/engine';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { runInvestigation } from '../agent/loop';
import { type Env, intVar } from '../env';
import { ApiError, toApiError } from '../lib/errors';
import type { SubrequestBudget } from '../lib/http';
import { cacheGet, consumeQuota, ipHash } from '../lib/store';
import { clientIp, enforceRateLimit } from '../middleware';
import { Investigator } from '../services/investigator';
import { analysisKey } from './core';

const Body = z.union([
  z.object({ scenarioId: z.string().min(1).max(10) }),
  z.object({ chain: z.enum(CHAINS as [string, ...string[]]), address: z.string().min(1).max(120) }),
]);

const PING_MS = 15_000;

export function registerAgentRoutes(app: Hono<{ Bindings: Env }>, newBudget: () => SubrequestBudget): void {
  app.post('/api/agent/investigate', async (c) => {
    await enforceRateLimit(c, 'RL_API');
    await enforceRateLimit(c, 'RL_AGENT');
    const body = Body.parse(await c.req.json().catch(() => ({})));
    let inv: Investigator;
    let scenarioMeta: ScenarioMeta | undefined;
    if ('scenarioId' in body) {
      const scenario = buildScenario(body.scenarioId);
      if (!scenario) throw new ApiError(404, 'NOT_FOUND', '找不到此情境。');
      inv = Investigator.forScenario(c.env, newBudget(), scenario);
      scenarioMeta = scenario.meta;
    } else {
      const chain = body.chain as AnalysisResult['subject']['chain'];
      inv = new Investigator({ env: c.env, budget: newBudget(), chain, address: body.address });
      const cached = await cacheGet<AnalysisResult>(c.env, analysisKey(chain, body.address));
      if (cached) inv.seed(cached);
    }

    const hash = await ipHash(clientIp(c));
    const perIp = intVar(c.env.AGENT_DAILY_PER_IP, 15);
    const quota = await consumeQuota(c.env, `agent:${hash}`, perIp);
    if (!quota.allowed) {
      throw new ApiError(429, 'QUOTA_EXCEEDED', `今日 AI 調查次數已達上限（每個 IP 每日 ${perIp} 次），請明天再試。`, 3600);
    }

    return streamSSE(c, async (stream) => {
      const started = Date.now();
      const send = (e: AgentEvent) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      const ping = setInterval(() => {
        stream.write(': ping\n\n').catch(() => undefined);
      }, PING_MS);
      try {
        await runInvestigation({ env: c.env, inv, emit: send, scenario: scenarioMeta, ipHash: hash });
      } catch (err) {
        const e = toApiError(err);
        if (e.code === 'INTERNAL') console.error('agent run failed', err);
        await send({ type: 'error', code: e.code, message: e.message, recoverable: false });
        await send({ type: 'done', investigationId: null, durationMs: Date.now() - started });
      } finally {
        clearInterval(ping);
      }
    });
  });
}
