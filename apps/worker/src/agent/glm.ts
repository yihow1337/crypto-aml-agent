import type { Env } from '../env';
import { BudgetExceededError, fetchJson, type SubrequestBudget, UpstreamError } from '../lib/http';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface GlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatResponse {
  choices?: { message: GlmMessage; finish_reason: string }[];
  error?: { code?: string; message?: string };
}

export class LlmUnavailableError extends Error {
  readonly code = 'LLM_UNAVAILABLE';
}

export function glmConfigured(env: Env): boolean {
  return Boolean(env.GLM_API_KEY && env.GLM_BASE_URL && env.GLM_MODEL);
}

/** One non-streaming chat completion against the Z.ai GLM OpenAI-compatible endpoint. */
export async function glmChat(
  env: Env,
  budget: SubrequestBudget,
  req: { messages: GlmMessage[]; tools?: ToolDefinition[]; maxTokens: number },
): Promise<{ message: GlmMessage; finishReason: string }> {
  if (!glmConfigured(env)) throw new LlmUnavailableError('未設定 GLM_API_KEY，改用規則模板報告。');
  const body: Record<string, unknown> = {
    model: env.GLM_MODEL,
    messages: req.messages,
    temperature: 0.2,
    max_tokens: req.maxTokens,
    stream: false,
    thinking: { type: env.GLM_THINKING === 'enabled' ? 'enabled' : 'disabled' },
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = 'auto';
  }
  let r: ChatResponse;
  try {
    r = await fetchJson<ChatResponse>(
      budget,
      `${env.GLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${env.GLM_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs: 60_000, retries: 1, retryDelayMs: 1500 },
    );
  } catch (e) {
    if (e instanceof BudgetExceededError) throw new LlmUnavailableError('外部查詢次數已用完，改用規則模板報告。');
    if (e instanceof UpstreamError) {
      const why = e.status === 0 ? '連線逾時' : `HTTP ${e.status}`;
      throw new LlmUnavailableError(`GLM API 無法使用（${why}），改用規則模板報告。`);
    }
    throw e;
  }
  const choice = r.choices?.[0];
  if (!choice) throw new LlmUnavailableError(`GLM API 回應異常：${r.error?.message ?? '無 choices'}`);
  if (choice.finish_reason === 'sensitive') throw new LlmUnavailableError('GLM 內容安全機制中止回應，改用規則模板報告。');
  return { message: choice.message, finishReason: choice.finish_reason };
}

/**
 * Incremental parser for the OpenAI-compatible SSE stream (`data: {...}` lines, `data: [DONE]`).
 * `push` returns the content deltas completed by this chunk.
 */
export class GlmStreamParser {
  finishReason = '';
  done = false;
  private buffer = '';

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      out += this.line(line);
    }
    return out;
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? this.line(rest) : '';
  }

  private line(line: string): string {
    if (!line.startsWith('data:')) return '';
    const payload = line.slice(5).trim();
    if (!payload) return '';
    if (payload === '[DONE]') {
      this.done = true;
      return '';
    }
    const msg = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
      error?: { message?: string };
    };
    if (msg.error) throw new LlmUnavailableError(`GLM 串流錯誤：${msg.error.message ?? '未知錯誤'}`);
    const choice = msg.choices?.[0];
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    return choice?.delta?.content ?? '';
  }
}

/**
 * Streamed completion without tools, used for the long final report: streaming keeps the
 * connection busy (no first-byte timeout on long generations) and lets the caller report progress.
 */
export async function glmChatStream(
  env: Env,
  budget: SubrequestBudget,
  req: {
    messages: GlmMessage[];
    maxTokens: number;
    onProgress?: (chars: number) => void | Promise<void>;
    idleMs?: number;
    totalMs?: number;
  },
): Promise<{ content: string; finishReason: string }> {
  if (!glmConfigured(env)) throw new LlmUnavailableError('未設定 GLM_API_KEY，改用規則模板報告。');
  const { idleMs = 45_000, totalMs = 170_000 } = req;
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const total = setTimeout(() => ctrl.abort(), totalMs);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), idleMs);
  };
  try {
    let res: Response;
    try {
      res = await budget.fetch(`${env.GLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.GLM_API_KEY}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          model: env.GLM_MODEL,
          messages: req.messages,
          temperature: 0.2,
          max_tokens: req.maxTokens,
          stream: true,
          thinking: { type: env.GLM_THINKING === 'enabled' ? 'enabled' : 'disabled' },
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof BudgetExceededError) throw new LlmUnavailableError('外部查詢次數已用完，改用規則模板報告。');
      throw new LlmUnavailableError('GLM API 連線失敗，改用規則模板報告。');
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      console.warn(`glm stream HTTP ${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 200)}`);
      throw new LlmUnavailableError(`GLM API 無法使用（HTTP ${res.status}），改用規則模板報告。`);
    }
    const parser = new GlmStreamParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let content = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        content += parser.push(decoder.decode(value, { stream: true }));
        await req.onProgress?.(content.length);
        if (parser.done) break;
      }
      content += parser.push(decoder.decode()) + parser.flush();
    } catch (e) {
      if (e instanceof LlmUnavailableError) throw e;
      throw new LlmUnavailableError(ctrl.signal.aborted ? 'GLM 回應逾時，改用規則模板報告。' : 'GLM 串流中斷，改用規則模板報告。');
    }
    return { content, finishReason: parser.finishReason || 'stop' };
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}
