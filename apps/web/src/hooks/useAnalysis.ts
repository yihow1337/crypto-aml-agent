'use client';

import type { AnalyzeResponse, Chain } from '@aml/engine';
import { api } from '@/lib/api';
import { useAsync, type AsyncState } from './useAsync';

export type AnalysisTarget = { kind: 'live'; chain: Chain; address: string } | { kind: 'scenario'; id: string };

export function targetKey(t: AnalysisTarget | null): string {
  if (!t) return '';
  return t.kind === 'live' ? `live:${t.chain}:${t.address}` : `scenario:${t.id}`;
}

/** Load `/api/analyze` (live) or `/api/scenarios/:id` (scenario) for the current target. */
export function useAnalysis(target: AnalysisTarget | null): AsyncState<AnalyzeResponse> {
  const key = targetKey(target);
  return useAsync<AnalyzeResponse>(
    (signal) => {
      if (!target) return Promise.reject(new Error('no target'));
      return target.kind === 'live'
        ? api.analyze(target.chain, target.address, signal)
        : api.scenario(target.id, signal);
    },
    [key],
    target !== null,
  );
}
