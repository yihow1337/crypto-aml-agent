import { describe, expect, it } from 'vitest';
import { AMOUNT_TIERS, amountTier } from './theme';

describe('amountTier', () => {
  it('buckets USD volume into five ordered tiers', () => {
    expect(amountTier(0)).toBe(0);
    expect(amountTier(999.99)).toBe(0);
    expect(amountTier(1_000)).toBe(1);
    expect(amountTier(9_999)).toBe(1);
    expect(amountTier(10_000)).toBe(2);
    expect(amountTier(250_000)).toBe(3);
    expect(amountTier(1_000_000)).toBe(4);
    expect(amountTier(5e9)).toBe(4);
  });

  it('treats missing or invalid values as the smallest tier', () => {
    expect(amountTier(Number.NaN)).toBe(0);
    expect(amountTier(-5)).toBe(0);
  });

  it('uses one hue that gets lighter as amounts grow (dark surface)', () => {
    expect(AMOUNT_TIERS).toHaveLength(5);
    expect(AMOUNT_TIERS.map((t) => t.color)).toEqual(['#184f95', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb']);
  });
});
