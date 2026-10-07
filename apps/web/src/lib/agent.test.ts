import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@aml/engine';
import { buildAgentView, toolZh } from './agent';

const events: AgentEvent[] = [
  { type: 'status', phase: 'fetching', message: '抓取資料' },
  {
    type: 'analysis',
    score: 92,
    level: 'critical',
    subject: { chain: 'eth', address: '0xabc' },
    hits: [{ id: 'R02', title: '制裁直接往來', severity: 'critical' }],
  },
  { type: 'tool_call', id: 't1', name: 'get_address_profile', args: { chain: 'eth' }, turn: 1 },
  { type: 'tool_call', id: 't2', name: 'screen_sanctions', args: {}, turn: 1 },
  { type: 'tool_result', id: 't2', name: 'screen_sanctions', ok: true, summary: '未列名', ms: 3 },
  { type: 'tool_result', id: 't1', name: 'get_address_profile', ok: false, summary: 'timeout', ms: 5000 },
  { type: 'budget', subrequests: 12, limit: 45, llmTurns: 2 },
  { type: 'error', code: 'LLM_UNAVAILABLE', message: 'GLM 逾時', recoverable: true },
  {
    type: 'report',
    markdown: '# 報告',
    source: 'template',
    guard: { scoreFixed: true, unverifiedRefs: 0 },
  },
  { type: 'done', investigationId: 'inv_1', durationMs: 1234 },
];

describe('buildAgentView', () => {
  const view = buildAgentView(events);

  it('pairs tool calls with their results by id, regardless of order', () => {
    expect(view.steps).toHaveLength(2);
    expect(view.steps[0]).toMatchObject({ id: 't1', result: { ok: false, ms: 5000 } });
    expect(view.steps[1]).toMatchObject({ id: 't2', result: { ok: true, summary: '未列名' } });
  });

  it('keeps the latest budget, analysis, report and done events', () => {
    expect(view.budget).toMatchObject({ subrequests: 12, limit: 45 });
    expect(view.analysis?.score).toBe(92);
    expect(view.report?.source).toBe('template');
    expect(view.done?.investigationId).toBe('inv_1');
    expect(view.phase).toBe('fetching');
  });

  it('lists status, steps and errors chronologically', () => {
    expect(view.items.map((i) => i.kind)).toEqual(['status', 'step', 'step', 'error']);
    expect(view.errors).toHaveLength(1);
  });

  it('shows orphan tool results as steps', () => {
    const v = buildAgentView([{ type: 'tool_result', id: 'x', name: 'get_transactions', ok: true, summary: 's', ms: 1 }]);
    expect(v.steps).toHaveLength(1);
    expect(v.items).toHaveLength(1);
  });

  it('translates tool names', () => {
    expect(toolZh('run_aml_analysis')).toBe('執行 AML 規則分析');
    expect(toolZh('unknown_tool')).toBe('unknown_tool');
  });
});
