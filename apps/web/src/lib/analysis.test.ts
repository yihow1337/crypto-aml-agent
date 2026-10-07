import { describe, expect, it } from 'vitest';
import { analyze, buildScenario, detectAnomalies, labelRisk, SanctionsIndex, type AnalysisResult } from '@aml/engine';
import { buildLookups, fillDays, scoreRange } from './analysis';

function scenario(id: string): AnalysisResult {
  const d = buildScenario(id);
  if (!d) throw new Error(`missing scenario ${id}`);
  const { meta: _meta, ...input } = d;
  return analyze({ ...input, sanctions: SanctionsIndex.fromSnapshot() });
}

describe('buildLookups (scenario s1: sanctioned funds into Tornado Cash)', () => {
  const r = scenario('s1');
  const lk = buildLookups(r);

  it('maps evidence tx hashes to rule ids', () => {
    const withRules = r.txs.filter((t) => lk.rulesOfTx(t.hash).length > 0);
    expect(withRules.length).toBeGreaterThan(0);
    const all = new Set(withRules.flatMap((t) => lk.rulesOfTx(t.hash)));
    expect([...all].some((id) => id === 'R02' || id === 'R04')).toBe(true);
  });

  it('resolves counterparty labels case-insensitively', () => {
    const tornado = r.counterparties.find((c) => c.labels.some((l) => l.category === 'mixer'));
    expect(tornado).toBeDefined();
    expect(lk.labelOf(tornado!.address.toUpperCase().replace('0X', '0x'))).toBe(tornado!.labels[0].name);
    expect(lk.labelsOf('0x0000000000000000000000000000000000000001')).toEqual([]);
  });
});

describe('scoreRange', () => {
  it('pads degenerate ranges and has a default', () => {
    expect(scoreRange(null)).toEqual([0.3, 0.8]);
    const [lo, hi] = scoreRange({ insufficient: false, scores: { a: 0.5, b: 0.5 }, flagged: [], threshold: 0.6 });
    expect(hi - lo).toBeCloseTo(0.05);
  });

  it('matches the browser-side Isolation Forest output on a scenario', () => {
    const r = scenario('s10');
    const risk = new Map(r.counterparties.map((c) => [c.address.toLowerCase(), labelRisk(c.labels)]));
    const res = detectAnomalies(r.txs, r.subject.address, (a) => risk.get(a.toLowerCase()) ?? labelRisk([]));
    if (res.insufficient) return; // scenario too small for the model — nothing to compare
    const [lo, hi] = scoreRange(res);
    for (const s of Object.values(res.scores)) {
      expect(s).toBeGreaterThanOrEqual(lo);
      expect(s).toBeLessThanOrEqual(hi);
    }
    // Deterministic: same seed → same scores.
    const again = detectAnomalies(r.txs, r.subject.address, (a) => risk.get(a.toLowerCase()) ?? labelRisk([]));
    expect(again.scores).toEqual(res.scores);
  });
});

describe('fillDays', () => {
  it('zero-fills missing UTC days between the first and last point', () => {
    const out = fillDays([
      { date: '2026-09-01', inUsd: 10, outUsd: 0, count: 1 },
      { date: '2026-09-04', inUsd: 0, outUsd: 5, count: 2 },
    ]);
    expect(out.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(out[1]).toEqual({ date: '2026-09-02', inUsd: 0, outUsd: 0, count: 0 });
    expect(out[3].outUsd).toBe(5);
  });
  it('handles empty input', () => {
    expect(fillDays([])).toEqual([]);
  });
});
