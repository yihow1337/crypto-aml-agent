import type { Context } from 'hono';
import type { Env } from './env';
import { ApiError } from './lib/errors';

export type AppContext = Context<{ Bindings: Env }>;

export function isAllowedOrigin(origin: string | undefined, env: Env): boolean {
  if (!origin) return false;
  const exact = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (exact.includes(origin)) return true;
  if (env.ALLOWED_ORIGIN_PATTERN) {
    try {
      return new RegExp(env.ALLOWED_ORIGIN_PATTERN).test(origin);
    } catch {
      return false;
    }
  }
  return false;
}

export function clientIp(c: AppContext): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** Workers Rate Limiting binding (per-location, eventually consistent); no-op when unbound. */
export async function enforceRateLimit(c: AppContext, binding: 'RL_AGENT' | 'RL_API'): Promise<void> {
  const rl = c.env[binding];
  if (!rl) return;
  const { success } = await rl.limit({ key: clientIp(c) });
  if (!success) throw new ApiError(429, 'RATE_LIMITED', '請求過於頻繁，請約一分鐘後再試。', 60);
}

export function requireAdmin(c: AppContext): void {
  const token = c.req.header('x-admin-token');
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) throw new ApiError(403, 'FORBIDDEN', '需要管理員權杖。');
}
