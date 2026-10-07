/** HTTP contract between the Cloudflare Worker (apps/worker) and the web app (apps/web). */
import type { ScenarioMeta } from './scenarios/index';
import type { AnalysisResult, Chain, RiskLevel, Severity } from './types';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export type ApiErrorCode =
  | 'INVALID_ADDRESS'
  | 'UNSUPPORTED_CHAIN'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'QUOTA_EXCEEDED'
  | 'CHAIN_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'INTERNAL';

export interface ChainStatus {
  available: boolean;
  source: string;
  note?: string;
}

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  version: string;
  glm: { configured: boolean; model: string; host: string };
  sanctions: { updatedAt: string; counts: { evm: number; tron: number; btc: number; total: number } };
  chains: Record<Chain, ChainStatus>;
  lastSweepAt: number | null;
}

/** GET /api/detect?address= */
export interface DetectResponse {
  valid: boolean;
  candidates: Chain[];
}

/** GET /api/analyze?chain=&address=  and  GET /api/scenarios/:id */
export type AnalyzeResponse = AnalysisResult & {
  cached: boolean;
  mode: 'live' | 'scenario';
  scenario?: ScenarioMeta;
};

/** GET /api/scenarios */
export interface ScenarioListResponse {
  items: ScenarioMeta[];
}

export type AlertSource = 'sweep' | 'watchlist' | 'investigation';

export interface Alert {
  id: number;
  chain: Chain;
  address: string;
  source: AlertSource;
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  txHash?: string;
  counterparty?: string;
  usd?: number;
  createdAt: number;
}

/** GET /api/alerts?limit=&chain=&severity=&since= */
export interface AlertsResponse {
  items: Alert[];
}

/** GET /api/stats */
export interface StatsResponse {
  alerts24h: { total: number; bySeverity: Record<Severity, number>; byChain: Record<Chain, number> };
  /** 24 hourly buckets, oldest first; `hour` is a unix timestamp (seconds) at the bucket start. */
  alertsHourly: { hour: number; count: number }[];
  /** Latest risk level of investigated + watched addresses. */
  riskDistribution: Record<RiskLevel, number>;
  investigations: number;
  watchlistCount: number;
  sanctions: HealthResponse['sanctions'];
  lastSweepAt: number | null;
}

export interface WatchlistItem {
  id: number;
  chain: Chain;
  address: string;
  label: string;
  createdAt: number;
  lastScannedAt: number | null;
  lastScore: number | null;
  lastLevel: RiskLevel | null;
}

/** GET /api/watchlist ; POST /api/watchlist {chain,address,label} → WatchlistItem */
export interface WatchlistResponse {
  items: WatchlistItem[];
  max: number;
}

export interface InvestigationSummary {
  id: string;
  chain: Chain;
  address: string;
  mode: 'live' | 'scenario';
  scenarioId?: string;
  score: number;
  level: RiskLevel;
  source: 'glm' | 'template';
  model?: string;
  createdAt: number;
}

export interface InvestigationDetail extends InvestigationSummary {
  reportMd: string;
  hits: { id: string; title: string; severity: Severity }[];
  trace: AgentEvent[];
}

/** GET /api/investigations */
export interface InvestigationListResponse {
  items: InvestigationSummary[];
}

/** Body of POST /api/agent/investigate */
export type InvestigateRequest = { chain: Chain; address: string } | { scenarioId: string };

/**
 * Server-sent events from POST /api/agent/investigate. Each SSE message uses
 * `event: <type>` and `data: <JSON of the whole event object>`.
 */
export type AgentEvent =
  | { type: 'status'; phase: 'fetching' | 'analyzing' | 'llm' | 'reporting'; message: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; turn: number }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; ms: number }
  | {
      type: 'analysis';
      score: number;
      level: RiskLevel;
      subject: { chain: Chain; address: string };
      hits: { id: string; title: string; severity: Severity }[];
    }
  | { type: 'thinking'; text: string }
  | { type: 'budget'; subrequests: number; limit: number; llmTurns: number }
  | {
      type: 'report';
      markdown: string;
      source: 'glm' | 'template';
      model?: string;
      guard: { scoreFixed: boolean; unverifiedRefs: number };
    }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'done'; investigationId: string | null; durationMs: number };

export type AgentEventType = AgentEvent['type'];
