import { normalizeAddress, shortAddress } from './address';
import { curatedLabels, hasCategory, labelRisk, primaryCategory } from './labels';
import type { RuleContext } from './rules/context';
import { RULE_CONFIG } from './rules/config';
import { RULES } from './rules/index';
import type { SanctionsIndex } from './sanctions';
import { scoreHits } from './scoring';
import { dailyCounts, median, robustZScores, utcDay } from './stats';
import type {
  AddressLabel,
  AddressProfile,
  AnalysisResult,
  CounterpartyExposure,
  CounterpartySummary,
  GraphEdge,
  GraphNode,
  NormTx,
  RuleHit,
  TimelinePoint,
} from './types';

export const ENGINE_VERSION = '1.0.0';
const MAX_RESULT_TXS = 500;
const MAX_GRAPH_COUNTERPARTIES = 25;

export interface AnalyzeInput {
  profile: AddressProfile;
  txs: NormTx[];
  sanctions: SanctionsIndex;
  /** Additional labels keyed by address (Blockscout tags, scenario labels…). */
  extraLabels?: Record<string, AddressLabel[]>;
  /** 1-hop exposure of counterparties from tracing. */
  exposure?: Record<string, CounterpartyExposure>;
  /** Number of consecutive peel hops found by tracing (BTC). */
  peelHops?: number;
  now?: number;
  /** True when the fetched history is a capped page rather than the full history. */
  truncated?: boolean;
  sources?: string[];
  notes?: string[];
}

function dedupeLabels(labels: AddressLabel[]): AddressLabel[] {
  const seen = new Set<string>();
  return labels.filter((l) => {
    const k = `${l.category}|${l.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Statistical anomaly index A ∈ [0,1]: share of unusual observations across three robust-z series —
 * amounts far above the address's median, unusually rapid successive transactions, and burst days.
 */
export function anomalyIndex(txs: NormTx[]): { index: number; amountOutliers: string[] } {
  const cfg = RULE_CONFIG.anomaly;
  if (txs.length < cfg.minN) return { index: 0, amountOutliers: [] };
  const valued = txs.filter((t) => (t.usd ?? 0) > 0);
  const med = median(valued.map((t) => t.usd ?? 0));
  const zAmount = robustZScores(valued.map((t) => Math.log10(1 + (t.usd ?? 0))));
  const amountOutliers = valued
    .filter((t, i) => zAmount[i] >= cfg.minZ && (t.usd ?? 0) >= cfg.minMedianMultiple * med)
    .map((t) => t.hash);
  const gaps: number[] = [];
  for (let i = 1; i < txs.length; i++) gaps.push(txs[i].ts - txs[i - 1].ts);
  const zGap = robustZScores(gaps.map((g) => Math.log10(1 + g)));
  const rapid = gaps.filter((g, i) => zGap[i] <= -cfg.minZ && g < cfg.rapidGapSec).length;
  const days = dailyCounts(txs.map((t) => t.ts), 90);
  const zDay = robustZScores(days.map((d) => d.count));
  const bursts = days.filter((d, i) => zDay[i] >= cfg.minZ && d.count >= cfg.burstMinCount).length;
  const total = amountOutliers.length + rapid + bursts;
  return { index: Math.min(1, total / Math.max(5, 0.1 * txs.length)), amountOutliers };
}

export function analyze(input: AnalyzeInput): AnalysisResult {
  const { profile, sanctions } = input;
  const chain = profile.chain;
  const norm = (a: string) => normalizeAddress(chain, a);

  const extra = new Map<string, AddressLabel[]>();
  for (const [k, v] of Object.entries(input.extraLabels ?? {})) extra.set(norm(k), [...(extra.get(norm(k)) ?? []), ...v]);

  const labelCache = new Map<string, AddressLabel[]>();
  const labelsOf = (address: string): AddressLabel[] => {
    const k = norm(address);
    let labels = labelCache.get(k);
    if (!labels) {
      labels = [...curatedLabels(chain, address), ...(extra.get(k) ?? [])];
      if (sanctions.has(chain, address)) labels.unshift({ name: 'OFAC SDN', category: 'sanctioned', source: 'ofac' });
      labels = dedupeLabels(labels);
      labelCache.set(k, labels);
    }
    return labels;
  };
  const isSanctioned = (address: string) =>
    sanctions.has(chain, address) || hasCategory(extra.get(norm(address)) ?? [], 'sanctioned');

  const all = [...input.txs].sort((a, b) => a.ts - b.ts || a.hash.localeCompare(b.hash));
  const txs = all.filter((t) => t.status === 'ok');
  const totalUsd = txs.reduce((s, t) => s + (t.usd ?? 0), 0);
  const subjectLabels = dedupeLabels([...profile.labels, ...labelsOf(profile.address)]);
  const now = input.now ?? Math.floor(Date.now() / 1000);

  const exposure = new Map<string, CounterpartyExposure>();
  for (const [k, v] of Object.entries(input.exposure ?? {})) exposure.set(norm(k), v);

  const ctx: RuleContext = {
    chain,
    subject: profile.address,
    profile,
    txs,
    now,
    truncated: input.truncated ?? false,
    peelHops: input.peelHops ?? 0,
    exposure,
    subjectLabels,
    totalUsd,
    norm,
    labelsOf,
    isSanctioned,
  };

  const hits: RuleHit[] = [];
  for (const rule of RULES) {
    if (rule.chains && !rule.chains.includes(chain)) continue;
    const outcome = rule.evaluate(ctx);
    if (!outcome) continue;
    hits.push({
      id: rule.id,
      title: rule.title,
      typology: rule.typology,
      severity: outcome.severity ?? rule.severity,
      weight: rule.weight,
      intensity: Math.max(0, Math.min(1, outcome.intensity)),
      contribution: 0,
      dampened: false,
      summary: outcome.summary,
      evidence: outcome.evidence,
    });
  }

  const anomaly = anomalyIndex(txs);
  const dampen = hasCategory(subjectLabels, 'exchange', 'service');
  const scored = scoreHits(hits, anomaly.index, dampen);
  hits.sort((a, b) => b.contribution - a.contribution);

  // Counterparty summaries.
  const cps = new Map<string, CounterpartySummary>();
  for (const t of txs) {
    if (t.direction === 'self' || !t.counterparty) continue;
    const k = norm(t.counterparty);
    let c = cps.get(k);
    if (!c) {
      const labels = labelsOf(t.counterparty);
      const sanctioned = isSanctioned(t.counterparty);
      c = {
        address: t.counterparty,
        labels,
        inUsd: 0,
        outUsd: 0,
        txCount: 0,
        firstTs: t.ts,
        lastTs: t.ts,
        sanctioned,
        risk: sanctioned ? 1 : labelRisk(labels),
      };
      cps.set(k, c);
    }
    if (t.direction === 'in') c.inUsd += t.usd ?? 0;
    else c.outUsd += t.usd ?? 0;
    c.txCount++;
    c.lastTs = t.ts;
  }
  for (const [k, e] of exposure) {
    const c = cps.get(k);
    if (c && (e.sanctioned || e.mixer)) c.risk = Math.max(c.risk, e.sanctioned ? 0.8 : 0.6);
  }
  const ranked = [...cps.values()].sort(
    (a, b) => b.inUsd + b.outUsd - (a.inUsd + a.outUsd) || b.txCount - a.txCount,
  );

  // Graph: subject + top counterparties.
  const nodes: GraphNode[] = [
    {
      id: profile.address,
      label: shortAddress(profile.address),
      category: 'subject',
      volumeUsd: totalUsd,
      risk: scored.score / 100,
    },
  ];
  const edges: GraphEdge[] = [];
  for (const c of ranked.slice(0, MAX_GRAPH_COUNTERPARTIES)) {
    nodes.push({
      id: c.address,
      label: c.labels[0]?.name ?? shortAddress(c.address),
      category: c.sanctioned ? 'sanctioned' : primaryCategory(c.labels),
      volumeUsd: c.inUsd + c.outUsd,
      risk: c.risk,
    });
    const inCount = txs.filter((t) => t.direction === 'in' && norm(t.counterparty) === norm(c.address)).length;
    const outCount = c.txCount - inCount;
    if (inCount > 0) edges.push({ source: c.address, target: profile.address, usd: c.inUsd, count: inCount });
    if (outCount > 0) edges.push({ source: profile.address, target: c.address, usd: c.outUsd, count: outCount });
  }

  // Daily timeline.
  const days = new Map<string, TimelinePoint>();
  for (const t of txs) {
    const date = utcDay(t.ts);
    const p = days.get(date) ?? { date, inUsd: 0, outUsd: 0, count: 0 };
    if (t.direction === 'in') p.inUsd += t.usd ?? 0;
    else if (t.direction === 'out') p.outUsd += t.usd ?? 0;
    p.count++;
    days.set(date, p);
  }
  const timeline = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);

  let inUsd = 0;
  let outUsd = 0;
  for (const t of txs) {
    if (t.direction === 'in') inUsd += t.usd ?? 0;
    else if (t.direction === 'out') outUsd += t.usd ?? 0;
  }

  const notes = [...(input.notes ?? [])];
  if (txs.length < 5) notes.push('交易筆數少於 5 筆，行為與統計類規則的可信度有限。');
  if (input.truncated) notes.push('僅分析最近一段交易紀錄（受 API 分頁上限限制），較早的歷史未納入。');
  if (dampen) notes.push('調查對象為交易所/服務商地址，行為類規則已依權重 ×0.3 減權。');

  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: Math.floor(Date.now() / 1000),
    subject: { chain, address: profile.address },
    profile: {
      ...profile,
      labels: subjectLabels,
      firstSeen: profile.firstSeen ?? (input.truncated ? undefined : txs[0]?.ts),
      lastSeen: profile.lastSeen ?? txs[txs.length - 1]?.ts,
    },
    txs: all.slice(-MAX_RESULT_TXS).reverse(),
    hits,
    score: scored.score,
    level: scored.level,
    sRules: scored.sRules,
    statsLift: scored.statsLift,
    floorApplied: scored.floorApplied,
    breakdown: scored.breakdown,
    stats: {
      n: txs.length,
      inUsd,
      outUsd,
      firstTs: txs[0]?.ts,
      lastTs: txs[txs.length - 1]?.ts,
      uniqueCounterparties: cps.size,
      anomalyIndex: anomaly.index,
      madOutliers: anomaly.amountOutliers,
    },
    counterparties: ranked.slice(0, 20),
    graph: { nodes, edges },
    timeline,
    dataQuality: { sources: input.sources ?? [], truncated: input.truncated ?? false, notes },
  };
}
