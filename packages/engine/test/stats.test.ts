import { describe, expect, it } from 'vitest';
import { dailyCounts, mad, median, robustZScores, utcDay } from '../src/stats';
import { isRoundAmount, rawToDecimal } from '../src/units';

describe('rawToDecimal', () => {
  it('converts wei to ether', () => {
    expect(rawToDecimal('1000000000000000000', 18)).toBe(1);
    expect(rawToDecimal('6438208349061858', 18)).toBeCloseTo(0.006438208349061858, 15);
  });
  it('converts 6-decimal tokens', () => {
    expect(rawToDecimal('620907555', 6)).toBe(620.907555);
  });
  it('keeps precision for values above 2^53', () => {
    expect(rawToDecimal('41938151268413673390144', 18)).toBeCloseTo(41938.15126841367, 8);
  });
  it('returns 0 for invalid input', () => {
    expect(rawToDecimal('', 18)).toBe(0);
    expect(rawToDecimal('abc', 18)).toBe(0);
  });
  it('handles zero decimals', () => {
    expect(rawToDecimal('42', 0)).toBe(42);
  });
});

describe('isRoundAmount', () => {
  it('treats single-significant-digit and whole-thousand amounts as round', () => {
    expect(isRoundAmount(10)).toBe(true);
    expect(isRoundAmount(5000)).toBe(true);
    expect(isRoundAmount(0.5)).toBe(true);
    expect(isRoundAmount(12000)).toBe(true);
  });
  it('rejects ordinary amounts and zero', () => {
    expect(isRoundAmount(0)).toBe(false);
    expect(isRoundAmount(1234.56)).toBe(false);
    expect(isRoundAmount(0.0731)).toBe(false);
  });
});

describe('median / mad', () => {
  it('computes the median of odd and even samples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it('computes the median absolute deviation', () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });
});

describe('robustZScores', () => {
  it('flags a clear outlier above 3.5', () => {
    const z = robustZScores([10, 11, 9, 10, 12, 10, 11, 500]);
    expect(z[7]).toBeGreaterThan(3.5);
    expect(Math.abs(z[0])).toBeLessThan(1);
  });
  it('falls back to mean absolute deviation when MAD is zero', () => {
    const z = robustZScores([5, 5, 5, 5, 5, 5, 100]);
    expect(z[6]).toBeGreaterThan(3.5);
  });
  it('returns zeros for constant input', () => {
    expect(robustZScores([2, 2, 2])).toEqual([0, 0, 0]);
  });
});

describe('utcDay / dailyCounts', () => {
  it('formats unix seconds as a UTC date', () => {
    expect(utcDay(0)).toBe('1970-01-01');
    expect(utcDay(1782000000)).toBe('2026-06-21');
  });
  it('fills empty days between first and last activity', () => {
    const day = 86400;
    const counts = dailyCounts([0, 10, day * 2 + 5]);
    expect(counts).toEqual([
      { date: '1970-01-01', count: 2 },
      { date: '1970-01-02', count: 0 },
      { date: '1970-01-03', count: 1 },
    ]);
  });
  it('caps the window to maxDays most recent days', () => {
    const day = 86400;
    const counts = dailyCounts([0, day * 200], 90);
    expect(counts.length).toBe(90);
    expect(counts[counts.length - 1].count).toBe(1);
  });
});
