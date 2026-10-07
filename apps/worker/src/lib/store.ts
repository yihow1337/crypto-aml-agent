import { type Env, nowSec } from '../env';

/** D1-backed key/value cache with expiry (analysis results, etc.). */
export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT json, expires_at FROM analysis_cache WHERE key = ?')
    .bind(key)
    .first<{ json: string; expires_at: number }>();
  if (!row || row.expires_at < nowSec()) return null;
  return JSON.parse(row.json) as T;
}

export async function cachePut(env: Env, key: string, value: unknown, ttlSec: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO analysis_cache (key, json, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at',
  )
    .bind(key, JSON.stringify(value), nowSec() + ttlSec)
    .run();
}

function windowStart(windowSec: number): number {
  return Math.floor(nowSec() / windowSec) * windowSec;
}

/** Atomically add `amount` to a fixed-window counter; `allowed` is false once `limit` is exceeded. */
export async function consumeQuota(
  env: Env,
  key: string,
  limit: number,
  amount = 1,
  windowSec = 86400,
): Promise<{ allowed: boolean; count: number }> {
  const start = windowStart(windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO quotas (key, count, window_start) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start < ?3 THEN ?2 ELSE count + ?2 END,
       window_start = CASE WHEN window_start < ?3 THEN ?3 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, amount, start)
    .first<{ count: number }>();
  const count = row?.count ?? amount;
  return { allowed: count <= limit, count };
}

export async function peekQuota(env: Env, key: string, windowSec = 86400): Promise<number> {
  const row = await env.DB.prepare('SELECT count, window_start FROM quotas WHERE key = ?')
    .bind(key)
    .first<{ count: number; window_start: number }>();
  if (!row || row.window_start < windowStart(windowSec)) return 0;
  return row.count;
}

export async function getCursor(env: Env, job: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT cursor FROM scan_cursors WHERE job = ?').bind(job).first<{ cursor: string }>();
  return row?.cursor ?? null;
}

export function setCursorStmt(env: Env, job: string, cursor: string): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO scan_cursors (job, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(job) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at',
  ).bind(job, cursor, nowSec());
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Store only a salted hash of client IPs. */
export async function ipHash(ip: string): Promise<string> {
  return (await sha256Hex(`crypto-aml-agent:${ip}`)).slice(0, 16);
}

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}
