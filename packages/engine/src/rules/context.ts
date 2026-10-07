import { fmtUsd } from '../format';
import type {
  AddressLabel,
  AddressProfile,
  Chain,
  CounterpartyExposure,
  Evidence,
  NormTx,
  Severity,
} from '../types';

export interface RuleContext {
  chain: Chain;
  subject: string;
  profile: AddressProfile;
  /** Successful transactions sorted by time ascending. */
  txs: NormTx[];
  now: number;
  truncated: boolean;
  peelHops: number;
  exposure: Map<string, CounterpartyExposure>;
  subjectLabels: AddressLabel[];
  /** Total USD volume of `txs` (transactions without a price count as 0). */
  totalUsd: number;
  norm(address: string): string;
  labelsOf(address: string): AddressLabel[];
  isSanctioned(address: string): boolean;
}

export interface RuleOutcome {
  intensity: number;
  severity?: Severity;
  summary: string;
  evidence: Evidence[];
}

export interface RuleDef {
  id: string;
  title: string;
  typology: string;
  description: string;
  severity: Severity;
  weight: number;
  chains?: Chain[];
  evaluate(ctx: RuleContext): RuleOutcome | null;
}

export function usdOf(t: NormTx): number {
  return t.usd ?? 0;
}

/** Share of activity in `subset`, by USD when prices exist, otherwise by count. */
export function activityShare(ctx: RuleContext, subset: NormTx[]): number {
  if (ctx.txs.length === 0) return 0;
  if (ctx.totalUsd > 0) return subset.reduce((s, t) => s + usdOf(t), 0) / ctx.totalUsd;
  return subset.length / ctx.txs.length;
}

/** Up to `limit` evidence items, largest USD first. */
export function txEvidence(txs: NormTx[], note: (t: NormTx) => string, limit = 5): Evidence[] {
  return [...txs]
    .sort((a, b) => usdOf(b) - usdOf(a) || b.ts - a.ts)
    .slice(0, limit)
    .map((t) => ({ txHash: t.hash, address: t.counterparty, ts: t.ts, usd: t.usd, note: note(t) }));
}

export function totalUsdText(txs: NormTx[]): string {
  return fmtUsd(txs.reduce((s, t) => s + usdOf(t), 0));
}

/** Largest number of distinct counterparties seen inside any sliding time window. */
export function maxDistinctInWindow(
  txs: NormTx[],
  windowSec: number,
  key: (t: NormTx) => string,
): { distinct: number; from: number; to: number } {
  const counts = new Map<string, number>();
  let best = { distinct: 0, from: 0, to: -1 };
  let start = 0;
  for (let end = 0; end < txs.length; end++) {
    const k = key(txs[end]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    while (txs[end].ts - txs[start].ts > windowSec) {
      const ks = key(txs[start]);
      const c = (counts.get(ks) ?? 1) - 1;
      if (c === 0) counts.delete(ks);
      else counts.set(ks, c);
      start++;
    }
    if (counts.size > best.distinct) best = { distinct: counts.size, from: start, to: end };
  }
  return best;
}
