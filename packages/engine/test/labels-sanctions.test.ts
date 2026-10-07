import { describe, expect, it } from 'vitest';
import {
  curatedLabels,
  isFakeStablecoin,
  labelRisk,
  labelsFromBlockscoutTags,
  primaryCategory,
} from '../src/labels';
import { SanctionsIndex } from '../src/sanctions';

describe('curatedLabels', () => {
  it('labels the Tornado Cash router as a mixer (case-insensitive)', () => {
    const labels = curatedLabels('eth', '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b');
    expect(labels[0]?.category).toBe('mixer');
    expect(labels[0]?.source).toBe('curated');
  });
  it('labels a Binance hot wallet as an exchange', () => {
    expect(curatedLabels('eth', '0x28C6c06298d514Db089934071355E5743bf21d60')[0]?.category).toBe(
      'exchange',
    );
  });
  it('returns [] for unknown addresses', () => {
    expect(curatedLabels('eth', '0x0000000000000000000000000000000000000001')).toEqual([]);
  });
});

describe('labelsFromBlockscoutTags', () => {
  it('maps phishing, sanctioned and exploit slugs', () => {
    const labels = labelsFromBlockscoutTags([
      { slug: 'phish--hack', name: 'Phish / Hack' },
      { slug: 'sanctioned', name: 'SANCTIONED' },
      { slug: 'exploit', name: 'Exploit' },
      { slug: 'ukraine-crypto-donation', name: 'Ukraine Crypto Donation' },
    ]);
    expect(labels.map((l) => l.category)).toEqual(['scam', 'sanctioned', 'scam']);
    expect(labels.every((l) => l.source === 'blockscout')).toBe(true);
  });
  it('maps exchange names and ignores notes', () => {
    const labels = labelsFromBlockscoutTags([
      { slug: 'binance-hot-wallet', name: 'Binance: Hot Wallet' },
      { slug: 'note0', name: 'note_0', tagType: 'note' },
    ]);
    expect(labels).toEqual([{ name: 'Binance: Hot Wallet', category: 'exchange', source: 'blockscout' }]);
  });
});

describe('labelRisk / primaryCategory', () => {
  it('uses the riskiest label', () => {
    const labels = [
      { name: 'a', category: 'exchange' as const, source: 'x' },
      { name: 'b', category: 'mixer' as const, source: 'x' },
    ];
    expect(labelRisk(labels)).toBe(0.9);
    expect(primaryCategory(labels)).toBe('mixer');
  });
  it('gives unlabeled addresses a small baseline risk', () => {
    expect(labelRisk([])).toBe(0.15);
    expect(primaryCategory([])).toBe('unknown');
  });
});

describe('isFakeStablecoin', () => {
  it('flags a USDT symbol on a non-canonical TRON contract', () => {
    expect(isFakeStablecoin('tron', 'USDT', 'TQgktYKdVbcJBWkLTN1V4YGXNeYfSaLyJA')).toBe(true);
  });
  it('accepts the canonical USDT contract', () => {
    expect(isFakeStablecoin('tron', 'USDT', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
    expect(isFakeStablecoin('eth', 'USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7')).toBe(false);
  });
  it('ignores non-stablecoin symbols', () => {
    expect(isFakeStablecoin('eth', 'PEPE', '0x0000000000000000000000000000000000000001')).toBe(false);
  });
});

describe('SanctionsIndex', () => {
  const idx = SanctionsIndex.fromSnapshot();
  it('matches the Ronin exploiter on ETH and BSC regardless of case', () => {
    expect(idx.has('eth', '0x098b716b8aaf21512996dc57eb0615e2383e2f96')).toBe(true);
    expect(idx.has('bsc', '0x098B716B8Aaf21512996dC57EB0615e2383E2f96')).toBe(true);
  });
  it('matches TRON and BTC lists', () => {
    expect(idx.has('tron', 'TA3rH2A7iHnm6pKH8gr9cK1EZnShnmZdFg')).toBe(true);
    expect(idx.has('btc', '123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX')).toBe(true);
  });
  it('routes T-addresses from the USDT list to TRON, not EVM', () => {
    expect(idx.counts().tron).toBeGreaterThan(261 - 1);
  });
  it('does not match unrelated addresses', () => {
    expect(idx.has('eth', '0x28C6c06298d514Db089934071355E5743bf21d60')).toBe(false);
  });
  it('can be rebuilt from fresh lists', () => {
    const fresh = SanctionsIndex.fromLists({ ETH: ['0x1111111111111111111111111111111111111111'] }, '2026-10-08');
    expect(fresh.has('bsc', '0x1111111111111111111111111111111111111111')).toBe(true);
    expect(fresh.updatedAt).toBe('2026-10-08');
  });
});
