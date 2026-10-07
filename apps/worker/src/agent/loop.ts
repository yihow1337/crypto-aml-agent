import { type AgentEvent, type AnalysisResult, renderTemplateReport, type ScenarioMeta } from '@aml/engine';
import { type Env, intVar, nowSec } from '../env';
import { BudgetExceededError } from '../lib/http';
import { consumeQuota, newId } from '../lib/store';
import type { Investigator } from '../services/investigator';
import { glmChat, glmConfigured, type GlmMessage, LlmUnavailableError } from './glm';
import { applyGuard, knownRefs } from './guard';
import { FINAL_INSTRUCTION, SYSTEM_PROMPT, userPrompt } from './prompt';
import { executeTool, TOOL_DEFS, TOOL_ZH } from './tools';

export const MAX_TURNS = 6;
export const MAX_TOOL_CALLS = 10;
export const MAX_PARALLEL = 3;
export const RUN_DEADLINE_MS = 150_000;
/** Subrequests kept back so the final report call always fits. */
const FINAL_RESERVE = 3;

export interface RunOptions {
  env: Env;
  inv: Investigator;
  emit: (e: AgentEvent) => Promise<void> | void;
  scenario?: ScenarioMeta;
  ipHash?: string;
}

export interface RunOutcome {
  investigationId: string | null;
  source: 'glm' | 'template';
  markdown: string;
  result: AnalysisResult;
}

class Run {
  readonly started = Date.now();
  readonly trace: AgentEvent[] = [];
  toolText = '';
  toolCalls = 0;
  llmTurns = 0;
  private seq = 0;

  constructor(readonly o: RunOptions) {}

  async emit(e: AgentEvent): Promise<void> {
    if (e.type !== 'report') this.trace.push(e);
    await this.o.emit(e);
  }

  async budget(): Promise<void> {
    const b = this.o.inv.budget;
    await this.emit({ type: 'budget', subrequests: b.used, limit: b.limit, llmTurns: this.llmTurns });
  }

  overDeadline(): boolean {
    return Date.now() - this.started > RUN_DEADLINE_MS;
  }

  /** Execute a tool, streaming tool_call / tool_result events. */
  async tool(name: string, args: Record<string, unknown> | string, id = `t${++this.seq}`): Promise<string> {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = typeof args === 'string' ? (JSON.parse(args || '{}') as Record<string, unknown>) : args;
    } catch {
      parsedArgs = {};
    }
    await this.emit({ type: 'tool_call', id, name, args: parsedArgs, turn: this.llmTurns });
    const t0 = Date.now();
    const out = await executeTool(this.o.inv, name, parsedArgs);
    this.toolCalls++;
    this.toolText += `\n${out.content}`;
    await this.emit({ type: 'tool_result', id, name, ok: out.ok, summary: out.summary, ms: Date.now() - t0 });
    return out.content;
  }
}

async function llmInvestigation(run: Run): Promise<string> {
  const { env, inv, scenario } = run.o;
  const messages: GlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(inv.chain, inv.subject, scenario) },
  ];
  let nudged = false;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (run.overDeadline() || inv.budget.remaining() <= FINAL_RESERVE) break;
    run.llmTurns = turn;
    await run.emit({ type: 'status', phase: 'llm', message: `第 ${turn} 輪：GLM 規劃下一步調查…` });
    const { message } = await glmChat(env, inv.budget, { messages, tools: TOOL_DEFS, maxTokens: 1500 });
    if (message.reasoning_content && env.GLM_THINKING === 'enabled') {
      await run.emit({ type: 'thinking', text: message.reasoning_content.slice(0, 500) });
    }
    const calls = message.tool_calls ?? [];
    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls.length ? calls : undefined, reasoning_content: message.reasoning_content });
    if (calls.length === 0) {
      const content = message.content?.trim() ?? '';
      if (run.toolCalls === 0 && !nudged) {
        nudged = true;
        messages.push({ role: 'user', content: '請先呼叫工具取得資料（至少 get_address_profile 與 run_aml_analysis），再撰寫報告。' });
        continue;
      }
      if (content.length > 200) return content;
      break;
    }
    const allowed = calls.slice(0, Math.max(0, Math.min(MAX_PARALLEL, MAX_TOOL_CALLS - run.toolCalls)));
    const results = await Promise.all(allowed.map((c) => run.tool(c.function.name, c.function.arguments, c.id)));
    allowed.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i] }));
    for (const c of calls.slice(allowed.length)) {
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: '已達本次工具呼叫上限，請直接撰寫報告。' }) });
    }
    await run.budget();
    if (run.toolCalls >= MAX_TOOL_CALLS) break;
  }
  await run.emit({ type: 'status', phase: 'reporting', message: 'GLM 撰寫調查報告中…' });
  messages.push({ role: 'user', content: FINAL_INSTRUCTION });
  run.llmTurns++;
  const { message } = await glmChat(env, inv.budget, { messages, maxTokens: 4000 });
  const content = message.content?.trim() ?? '';
  if (content.length < 100) throw new LlmUnavailableError('GLM 未產生有效報告，改用規則模板報告。');
  return content;
}

/** Deterministic investigation path used when the LLM is unavailable. */
async function templateInvestigation(run: Run): Promise<void> {
  const { inv } = run.o;
  await run.tool('get_address_profile', {});
  await run.tool('get_transactions', {});
  const r = await inv.analyze();
  const worthTracing = r.counterparties.some((c) => !c.sanctioned && c.labels.length === 0);
  if (worthTracing && inv.traced === null) await run.tool('trace_counterparties', { top_n: 5 });
  await run.tool('run_aml_analysis', {});
}

async function persist(run: Run, result: AnalysisResult, markdown: string, source: 'glm' | 'template'): Promise<string> {
  const { env, inv, scenario, ipHash } = run.o;
  const id = newId();
  const now = nowSec();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO investigations (id, chain, address, mode, scenario_id, score, level, hits_json, report_md, source, model, trace_json, created_at, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      inv.chain,
      inv.subject,
      inv.mode,
      scenario?.id ?? null,
      result.score,
      result.level,
      JSON.stringify(result.hits.map((h) => ({ id: h.id, title: h.title, severity: h.severity }))),
      markdown,
      source,
      source === 'glm' ? env.GLM_MODEL : null,
      JSON.stringify(run.trace),
      now,
      ipHash ?? null,
    ),
  ];
  if (inv.mode === 'live') {
    for (const h of result.hits.filter((x) => x.severity === 'high' || x.severity === 'critical')) {
      const ev = h.evidence[0];
      stmts.push(
        env.DB.prepare(
          `INSERT INTO alerts (chain, address, source, rule_id, severity, title, detail, tx_hash, counterparty, usd, created_at)
           VALUES (?, ?, 'investigation', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        ).bind(inv.chain, inv.subject, h.id, h.severity, h.title, h.summary, ev?.txHash ?? `inv:${id}`, ev?.address ?? null, ev?.usd ?? null, now),
      );
    }
  }
  await env.DB.batch(stmts);
  return id;
}

/** Full agent run: deterministic analysis → GLM tool-calling loop (or template fallback) → guard → persist. */
export async function runInvestigation(o: RunOptions): Promise<RunOutcome> {
  const run = new Run(o);
  const { env, inv } = o;
  await run.emit({ type: 'status', phase: 'fetching', message: '取得鏈上資料並執行規則引擎…' });
  const first = await inv.analyze();
  await run.emit({
    type: 'analysis',
    score: first.score,
    level: first.level,
    subject: first.subject,
    hits: first.hits.map((h) => ({ id: h.id, title: h.title, severity: h.severity })),
  });
  await run.budget();

  let llmText: string | null = null;
  if (!glmConfigured(env)) {
    await run.emit({ type: 'error', code: 'LLM_UNAVAILABLE', message: '未設定 GLM API 金鑰，改用規則模板報告。', recoverable: true });
  } else {
    const quota = await consumeQuota(env, 'glm-global', intVar(env.GLM_DAILY_GLOBAL, 300));
    if (!quota.allowed) {
      await run.emit({ type: 'error', code: 'QUOTA_EXCEEDED', message: '今日 GLM 呼叫總額度已用完，改用規則模板報告。', recoverable: true });
    } else {
      try {
        llmText = await llmInvestigation(run);
      } catch (e) {
        if (!(e instanceof LlmUnavailableError || e instanceof BudgetExceededError)) throw e;
        await run.emit({ type: 'error', code: 'LLM_UNAVAILABLE', message: e.message, recoverable: true });
      }
    }
  }

  if (llmText === null) {
    await run.emit({ type: 'status', phase: 'analyzing', message: '以確定性流程完成調查步驟…' });
    await templateInvestigation(run);
  }
  await inv.flushUsage();
  const result = await inv.analyze();
  let markdown: string;
  let guard = { scoreFixed: false, unverifiedRefs: 0 };
  const source: 'glm' | 'template' = llmText === null ? 'template' : 'glm';
  if (llmText === null) {
    markdown = renderTemplateReport(result, { scenarioTitle: o.scenario?.title });
  } else {
    const g = applyGuard(llmText, result, knownRefs(result, run.toolText));
    markdown = g.markdown;
    guard = { scoreFixed: g.scoreFixed, unverifiedRefs: g.unverifiedRefs };
  }
  await run.budget();
  const investigationId = await persist(run, result, markdown, source);
  await run.emit({ type: 'report', markdown, source, model: source === 'glm' ? env.GLM_MODEL : undefined, guard });
  await run.emit({ type: 'done', investigationId, durationMs: Date.now() - run.started });
  return { investigationId, source, markdown, result };
}

export { TOOL_ZH };
