export interface Env {
  DB: D1Database;
  RL_AGENT?: RateLimit;
  RL_API?: RateLimit;

  // Secrets (wrangler secret put …)
  GLM_API_KEY?: string;
  ZERION_API_KEY?: string;
  TRONGRID_API_KEY?: string;
  BLOCKSCOUT_API_KEY?: string;
  ADMIN_TOKEN?: string;

  // Vars (wrangler.jsonc)
  GLM_BASE_URL: string;
  GLM_MODEL: string;
  GLM_THINKING?: string;
  ALLOWED_ORIGINS: string;
  ALLOWED_ORIGIN_PATTERN?: string;
  AGENT_DAILY_PER_IP?: string;
  GLM_DAILY_GLOBAL?: string;
  ZERION_DAILY_REQUESTS?: string;
  WATCHLIST_MAX?: string;
  WATCHLIST_MAX_BSC?: string;
  WATCHLIST_DAILY_PER_IP?: string;
}

export const VERSION = '1.0.0';

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
