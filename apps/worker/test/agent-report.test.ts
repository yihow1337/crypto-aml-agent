import type { AgentEvent } from '@aml/engine';
import { describe, expect, it } from 'vitest';
import { GlmStreamParser } from '../src/agent/glm';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { createTestD1 } from './helpers/d1-sqlite';
import { mockFetch } from './helpers/fetch-mock';

function makeEnv(): Env {
  return {
    DB: createTestD1(),
    GLM_API_KEY: 'sk-test',
    GLM_BASE_URL: 'https://glm.test/api/paas/v4',
    GLM_MODEL: 'glm-test',
    GLM_THINKING: 'disabled',
    ALLOWED_ORIGINS: 'http://localhost:3000',
  };
}

const TOOL_TURN = {
  finish_reason: 'tool_calls',
  message: {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'get_address_profile', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'run_aml_analysis', arguments: '{}' } },
    ],
  },
};

const sse = (chunks: { content?: string; finish?: string }[]) =>
  new Response(
    chunks
      .map((c) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: c.content ? { content: c.content } : {}, finish_reason: c.finish ?? null }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );

function parseSse(text: string): AgentEvent[] {
  return text
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(5).trim()) as AgentEvent);
}

async function investigate(responder: (body: Record<string, unknown>, n: number) => Response | object) {
  const bodies: Record<string, unknown>[] = [];
  const m = mockFetch([
    ['glm.test', (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return responder(body, bodies.length);
    }],
  ]);
  const res = await createApp({ fetcher: m.fetch }).request(
    '/api/agent/investigate',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 's3' }) },
    makeEnv(),
  );
  const events = parseSse(await res.text());
  const report = events.find((e) => e.type === 'report') as Extract<AgentEvent, { type: 'report' }>;
  return { events, report, bodies };
}

const FULL_REPORT = `# 虛擬資產反洗錢調查報告\n## 一、摘要\n${'此地址疑似以拆分方式規避申報門檻。'.repeat(12)}\n## 五、建議措施\n- 加強盡職調查。\n## 六、資料限制與免責聲明\n本報告僅供參考。`;

describe('GLM report completeness', () => {
  it('discards a report cut off by max_tokens and writes it in the dedicated streaming call', async () => {
    const { report, events, bodies } = await investigate((body, n) => {
      if (body.stream) return sse([{ content: FULL_REPORT.slice(0, 40) }, { content: FULL_REPORT.slice(40), finish: 'stop' }]);
      if (n === 1) return { choices: [TOOL_TURN] };
      return { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '# 虛擬資產反洗錢調查報告\n## 一、摘要\n寫到一半被截' } }] };
    });
    expect(report.source).toBe('glm');
    expect(report.markdown).toContain('六、資料限制與免責聲明');
    expect(report.markdown).not.toContain('寫到一半被截');
    expect(events.some((e) => e.type === 'status' && e.phase === 'reporting')).toBe(true);
    const final = bodies.at(-1)!;
    expect(final.stream).toBe(true);
    expect(final.tools).toBeUndefined();
    expect(Number(final.max_tokens)).toBeGreaterThanOrEqual(8000);
  });

  it('continues a streamed report that still hits the length limit', async () => {
    const { report, bodies } = await investigate((body, n) => {
      if (!body.stream) return n === 1 ? { choices: [TOOL_TURN] } : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '資料已足夠。' } }] };
      const messages = body.messages as { role: string; content: string }[];
      const continuing = messages.at(-1)!.content.includes('中斷處');
      return continuing
        ? sse([{ content: FULL_REPORT.slice(30), finish: 'stop' }])
        : sse([{ content: FULL_REPORT.slice(0, 30), finish: 'length' }]);
    });
    expect(report.markdown).toContain('六、資料限制與免責聲明');
    expect(report.markdown).toContain('一、摘要');
    const cont = bodies.at(-1)!.messages as { role: string; content: string }[];
    expect(cont.at(-2)).toMatchObject({ role: 'assistant', content: FULL_REPORT.slice(0, 30) });
  });

  it('accepts a complete report written within a tool turn without an extra call', async () => {
    const { report, bodies } = await investigate((_body, n) =>
      n === 1 ? { choices: [TOOL_TURN] } : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: FULL_REPORT } }] },
    );
    expect(report.markdown).toContain('六、資料限制與免責聲明');
    expect(bodies.every((b) => !b.stream)).toBe(true);
  });
});

describe('GlmStreamParser', () => {
  it('reassembles deltas split across chunk boundaries and records the finish reason', () => {
    const p = new GlmStreamParser();
    const wire =
      'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n' +
      ': keep-alive\n\n' +
      'data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    let text = '';
    for (let i = 0; i < wire.length; i += 7) text += p.push(wire.slice(i, i + 7));
    text += p.flush();
    expect(text).toBe('你好，世界');
    expect(p.finishReason).toBe('stop');
    expect(p.done).toBe(true);
  });

  it('surfaces an error object sent inside the stream', () => {
    const p = new GlmStreamParser();
    expect(() => p.push('data: {"error":{"message":"quota exceeded"}}\n\n')).toThrow(/quota exceeded/);
  });
});
