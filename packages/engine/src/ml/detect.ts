import { FEATURE_NAMES, FEATURE_ZH, txFeatures } from '../features';
import { robustZScores } from '../stats';
import type { NormTx } from '../types';
import { IsolationForest } from './iforest';
import { seedFromString } from './rng';

export const MIN_SAMPLES = 20;
const ABS_THRESHOLD = 0.6;
const REL_FLOOR = 0.5;

export interface AnomalyFlag {
  hash: string;
  score: number;
  reason: string;
}

export interface AnomalyResult {
  insufficient: boolean;
  scores: Record<string, number>;
  flagged: AnomalyFlag[];
  threshold: number;
}

/**
 * Isolation-Forest anomaly detection over an address's transactions. Flags scores above 0.6,
 * or the top 5% when they exceed 0.5. Each flag is explained by its most deviant feature.
 */
export function detectAnomalies(
  txs: NormTx[],
  seedKey: string,
  labelRiskOf: (address: string) => number = () => 0.15,
): AnomalyResult {
  const sorted = txs.filter((t) => t.status === 'ok').sort((a, b) => a.ts - b.ts);
  if (sorted.length < MIN_SAMPLES) return { insufficient: true, scores: {}, flagged: [], threshold: ABS_THRESHOLD };

  const X = txFeatures(sorted, labelRiskOf);
  const scores = new IsolationForest({ seed: seedFromString(seedKey) }).fit(X).score(X);

  const desc = [...scores].sort((a, b) => b - a);
  const p95 = desc[Math.floor(desc.length * 0.05)] ?? 1;
  const threshold = Math.min(ABS_THRESHOLD, Math.max(REL_FLOOR, p95));

  const columnZ = FEATURE_NAMES.map((_, f) => robustZScores(X.map((r) => r[f])));
  const flagged: AnomalyFlag[] = [];
  const byHash: Record<string, number> = {};
  sorted.forEach((t, i) => {
    byHash[t.hash] = scores[i];
    if (scores[i] < threshold) return;
    let best = 0;
    for (let f = 1; f < FEATURE_NAMES.length; f++) {
      if (Math.abs(columnZ[f][i]) > Math.abs(columnZ[best][i])) best = f;
    }
    const zi = columnZ[best][i];
    flagged.push({
      hash: t.hash,
      score: scores[i],
      reason: `${FEATURE_ZH[FEATURE_NAMES[best]]}異常（z=${zi >= 0 ? '+' : ''}${zi.toFixed(1)}）`,
    });
  });
  flagged.sort((a, b) => b.score - a.score);
  return { insufficient: false, scores: byHash, flagged, threshold };
}
