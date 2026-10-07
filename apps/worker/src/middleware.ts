import type { Context } from 'hono';
import type { Env } from './env';
import { ApiError } from './lib/errors';
import { ipHash, sha256Hex } from './lib/store';

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

/** Compares SHA-256 digests in constant time so the token can't be guessed byte by byte. */
async function tokensEqual(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(c: AppContext): Promise<void> {
  const expected = c.env.ADMIN_TOKEN;
  const given = c.req.header('x-admin-token') ?? '';
  if (!expected || !(await tokensEqual(given, expected))) {
    throw new ApiError(403, 'FORBIDDEN', '需要有效的管理員權杖。');
  }
}

/** Rejects clients an administrator has blocked; returns the client's anonymous id. */
export async function enforceNotBlocked(c: AppContext): Promise<string> {
  const hash = await ipHash(clientIp(c));
  let row: { reason: string } | null = null;
  try {
    row = await c.env.DB.prepare('SELECT reason FROM blocked_clients WHERE ip_hash = ?').bind(hash).first<{ reason: string }>();
  } catch (e) {
    // Fail open: a broken block list (e.g. a migration not yet applied) must not take the API down.
    console.error('block list lookup failed', e);
  }
  if (row) throw new ApiError(403, 'FORBIDDEN', `此來源已被管理員封鎖${row.reason ? `（${row.reason}）` : ''}。`);
  return hash;
}
