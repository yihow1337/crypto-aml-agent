'use client';

import { useMemo } from 'react';
import { detectAnomalies, labelRisk, MIN_SAMPLES, type AnalysisResult, type AnomalyResult } from '@aml/engine';

export interface IsolationForestState {
  result: AnomalyResult | null;
  /** Wall time of fit + score in the browser. */
  ms: number;
  minSamples: number;
  /** Number of successful transactions fed to the model. */
  n: number;
}

/**
 * Browser-side Isolation Forest over the analysis transactions (deterministic: seeded by the
 * subject address). Counterparty label risk comes from the analysis' labelled counterparties.
 */
export function useIsolationForest(analysis: AnalysisResult | null | undefined): IsolationForestState {
  return useMemo(() => {
    if (!analysis) return { result: null, ms: 0, minSamples: MIN_SAMPLES, n: 0 };
    const risk = new Map<string, number>();
    for (const c of analysis.counterparties) {
      risk.set(c.address.toLowerCase(), c.sanctioned ? 1 : labelRisk(c.labels));
    }
    const fallback = labelRisk([]);
    const labelRiskOf = (address: string) => risk.get(address.toLowerCase()) ?? fallback;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = detectAnomalies(analysis.txs, analysis.subject.address, labelRiskOf);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const n = analysis.txs.filter((t) => t.status === 'ok').length;
    return { result, ms: t1 - t0, minSamples: MIN_SAMPLES, n };
  }, [analysis]);
}
