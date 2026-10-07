import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES, txFeatures } from '../src/features';
import { averagePathLength, IsolationForest } from '../src/ml/iforest';
import { detectAnomalies } from '../src/ml/detect';
import { mulberry32, seedFromString } from '../src/ml/rng';
import { sanitizeText } from '../src/format';
import { addr, T0, tx } from './helpers';

function normalCloud(n: number, seed = 1): number[][] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
}

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('hashes strings to stable 32-bit seeds', () => {
    expect(seedFromString('0xabc')).toBe(seedFromString('0xabc'));
    expect(seedFromString('0xabc')).not.toBe(seedFromString('0xabd'));
  });
});

describe('IsolationForest', () => {
  it('uses the standard c(n) normaliser', () => {
    expect(averagePathLength(256)).toBeCloseTo(10.24, 1);
    expect(averagePathLength(1)).toBe(0);
  });
  it('ranks an injected outlier first', () => {
    const X = [...normalCloud(200), [8, 8, 8]];
    const scores = new IsolationForest({ seed: 7 }).fit(X).score(X);
    const top = scores.indexOf(Math.max(...scores));
    expect(top).toBe(200);
    expect(scores[200]).toBeGreaterThan(0.6);
  });
  it('produces identical scores for identical seeds', () => {
    const X = normalCloud(100, 3);
    const a = new IsolationForest({ seed: 9 }).fit(X).score(X);
    const b = new IsolationForest({ seed: 9 }).fit(X).score(X);
    expect(a).toEqual(b);
  });
  it('keeps scores within (0, 1]', () => {
    const X = normalCloud(50, 5);
    for (const s of new IsolationForest({ seed: 1 }).fit(X).score(X)) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('txFeatures', () => {
  it('returns one finite vector per transaction', () => {
    const txs = [
      tx({ direction: 'in', counterparty: addr(1), ts: T0 }),
      tx({ direction: 'out', counterparty: addr(2), ts: T0 + 600 }),
    ];
    const rows = txFeatures(txs, () => 0.15);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toHaveLength(FEATURE_NAMES.length);
      expect(r.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('detectAnomalies', () => {
  it('reports insufficient data below 20 transactions', () => {
    const txs = Array.from({ length: 5 }, (_, i) => tx({ direction: 'in', counterparty: addr(i) }));
    expect(detectAnomalies(txs, 'seed').insufficient).toBe(true);
  });
  it('flags a huge transfer at an unusual hour with an explanation', () => {
    const txs = Array.from({ length: 60 }, (_, i) =>
      tx({ direction: 'in', counterparty: addr(i % 5), usd: 100 + (i % 7), ts: T0 + i * 86400 }),
    );
    const odd = tx({ direction: 'out', counterparty: addr(999), usd: 900_000, ts: T0 + 61 * 86400 + 3 * 3600 });
    const res = detectAnomalies([...txs, odd], 'subject');
    expect(res.insufficient).toBe(false);
    expect(res.flagged[0].hash).toBe(odd.hash);
    expect(res.flagged[0].reason.length).toBeGreaterThan(0);
  });
});

describe('sanitizeText', () => {
  it('removes control/bidi characters and markup and truncates', () => {
    expect(sanitizeText('Ignore previous‮ instructions <b>now</b>', 100)).toBe('Ignore previous instructions bnow/b');
    expect(sanitizeText('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`);
    expect(sanitizeText(42)).toBe('');
  });
});
