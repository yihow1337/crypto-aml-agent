export type Chain = 'eth' | 'bsc' | 'tron' | 'btc';
export const CHAINS: Chain[] = ['eth', 'bsc', 'tron', 'btc'];

export type Direction = 'in' | 'out' | 'self';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RiskLevel = Severity;

export interface Asset {
  symbol: string;
  /** Token contract; undefined for the chain's native coin. */
  contract?: string;
  decimals: number;
}

/** Extra UTXO detail for Bitcoin transactions. Values are in BTC. */
export interface BtcDetail {
  nIn: number;
  nOut: number;
  inputAddrs: string[];
  outputAddrs: string[];
  outValues: number[];
  /** Outputs paid to the subject minus inputs spent by the subject (BTC). */
  subjectNet: number;
}

/** Chain-agnostic transfer as seen from the subject address. */
export interface NormTx {
  chain: Chain;
  hash: string;
  /** Unix seconds. */
  ts: number;
  block?: number;
  direction: Direction;
  from: string;
  to: string;
  /** The other party relative to the subject. */
  counterparty: string;
  asset: Asset;
  /** Decimal units of `asset` (absolute value). */
  amount: number;
  amountRaw?: string;
  usd?: number;
  kind: 'native' | 'token' | 'internal';
  status: 'ok' | 'failed';
  method?: string;
  btc?: BtcDetail;
}

export type LabelCategory =
  | 'sanctioned'
  | 'mixer'
  | 'exchange'
  | 'bridge'
  | 'scam'
  | 'high_risk'
  | 'gambling'
  | 'defi'
  | 'service'
  | 'stablecoin'
  | 'other';

export interface AddressLabel {
  name: string;
  category: LabelCategory;
  /** e.g. 'curated', 'blockscout', 'ofac', 'scenario' */
  source: string;
}

export interface AddressProfile {
  chain: Chain;
  address: string;
  nativeSymbol: string;
  balance?: number;
  balanceUsd?: number;
  txCount?: number;
  firstSeen?: number;
  lastSeen?: number;
  isContract?: boolean;
  nonce?: number;
  labels: AddressLabel[];
}

/** 1-hop exposure of a counterparty, produced by tracing. */
export interface CounterpartyExposure {
  sanctioned: boolean;
  mixer: boolean;
  /** Address of the risky party the counterparty touched. */
  via?: string;
  note?: string;
}

export interface Evidence {
  txHash?: string;
  address?: string;
  ts?: number;
  usd?: number;
  note: string;
}

export interface RuleHit {
  id: string;
  title: string;
  typology: string;
  severity: Severity;
  weight: number;
  /** Intensity c in [0, 1]. */
  intensity: number;
  /** weight × intensity × dampener; filled in by scoring. */
  contribution: number;
  dampened: boolean;
  summary: string;
  evidence: Evidence[];
}

export interface CounterpartySummary {
  address: string;
  labels: AddressLabel[];
  inUsd: number;
  outUsd: number;
  txCount: number;
  firstTs: number;
  lastTs: number;
  sanctioned: boolean;
  risk: number;
}

export interface GraphNode {
  id: string;
  label: string;
  category: LabelCategory | 'subject' | 'unknown';
  volumeUsd: number;
  risk: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  usd: number;
  count: number;
}

export interface TimelinePoint {
  /** YYYY-MM-DD (UTC) */
  date: string;
  inUsd: number;
  outUsd: number;
  count: number;
}

export interface ScoreBreakdownItem {
  id: string;
  title: string;
  points: number;
}

export interface AnalysisStats {
  n: number;
  inUsd: number;
  outUsd: number;
  firstTs?: number;
  lastTs?: number;
  uniqueCounterparties: number;
  anomalyIndex: number;
  madOutliers: string[];
}

export interface DataQuality {
  sources: string[];
  truncated: boolean;
  notes: string[];
}

export interface AnalysisResult {
  engineVersion: string;
  generatedAt: number;
  subject: { chain: Chain; address: string };
  profile: AddressProfile;
  txs: NormTx[];
  hits: RuleHit[];
  score: number;
  level: RiskLevel;
  sRules: number;
  statsLift: number;
  floorApplied?: string;
  breakdown: ScoreBreakdownItem[];
  stats: AnalysisStats;
  counterparties: CounterpartySummary[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  timeline: TimelinePoint[];
  dataQuality: DataQuality;
}
