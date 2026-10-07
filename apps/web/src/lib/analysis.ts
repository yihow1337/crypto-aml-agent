import type { AddressLabel, AnalysisResult, AnomalyResult, TimelinePoint } from '@aml/engine';
import { baseTxHash } from './explorer';

export interface AnalysisLookups {
  /** Labels for a counterparty / evidence address (from the analysis' counterparties, graph and profile). */
  labelsOf: (address: string) => AddressLabel[];
  /** Display name of the most relevant label, if any. */
  labelOf: (address: string) => string | undefined;
  /** Rule ids whose evidence references a transaction hash. */
  rulesOfTx: (hash: string) => string[];
}

const key = (s: string) => s.trim().toLowerCase();

export function buildLookups(a: AnalysisResult): AnalysisLookups {
  const labels = new Map<string, AddressLabel[]>();
  const names = new Map<string, string>();
  for (const c of a.counterparties) {
    if (c.labels.length) labels.set(key(c.address), c.labels);
    if (c.sanctioned && !c.labels.some((l) => l.category === 'sanctioned')) {
      labels.set(key(c.address), [...c.labels, { name: 'OFAC 制裁名單', category: 'sanctioned', source: 'ofac' }]);
    }
  }
  for (const n of a.graph.nodes) {
    if (n.category !== 'unknown' && n.category !== 'subject' && n.label && !names.has(key(n.id))) {
      names.set(key(n.id), n.label);
    }
  }
  if (a.profile.labels.length) labels.set(key(a.subject.address), a.profile.labels);

  const txRules = new Map<string, Set<string>>();
  for (const h of a.hits) {
    for (const e of h.evidence) {
      if (!e.txHash) continue;
      const k = key(baseTxHash(e.txHash));
      const set = txRules.get(k) ?? new Set<string>();
      set.add(h.id);
      txRules.set(k, set);
    }
  }

  return {
    labelsOf: (addr) => labels.get(key(addr)) ?? [],
    labelOf: (addr) => labels.get(key(addr))?.[0]?.name ?? names.get(key(addr)),
    rulesOfTx: (hash) => [...(txRules.get(key(baseTxHash(hash))) ?? [])].sort(),
  };
}

/** [min, max] of the Isolation-Forest scores (padded so the colour ramp never collapses). */
export function scoreRange(anomaly: AnomalyResult | null | undefined): [number, number] {
  const vals = anomaly ? Object.values(anomaly.scores) : [];
  if (vals.length === 0) return [0.3, 0.8];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 0.05) {
    min = Math.max(0, min - 0.025);
    max = min + 0.05;
  }
  return [min, max];
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;

/** Zero-fill the (sparse) UTC daily timeline so gaps in activity stay visible. */
export function fillDays(timeline: TimelinePoint[]): TimelinePoint[] {
  if (timeline.length === 0) return [];
  const byDate = new Map(timeline.map((p) => [p.date, p]));
  const first = Date.parse(`${timeline[0].date}T00:00:00Z`);
  const last = Date.parse(`${timeline[timeline.length - 1].date}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || (last - first) / DAY_MS > MAX_DAYS) return timeline;
  const out: TimelinePoint[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, inUsd: 0, outUsd: 0, count: 0 });
  }
  return out;
}
