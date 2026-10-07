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
