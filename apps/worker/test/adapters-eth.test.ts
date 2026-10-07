import { describe, expect, it } from 'vitest';
import { EthBlockscoutSource } from '../src/adapters/eth-blockscout';
import { SubrequestBudget } from '../src/lib/http';
import { FALLBACK_PRICES } from '../src/lib/prices';
import { fixture, json, mockFetch } from './helpers/fetch-mock';

const RONIN = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';
const BINANCE = '0x28C6c06298d514Db089934071355E5743bf21d60';
const PHISHER = '0x985409C0E4B1853A42800765baFcD9EFc1c57D03';
const prices = { ...FALLBACK_PRICES, ETH: 2500, source: 'fallback' as const };
const emptyPage = { items: [], next_page_params: null };

function source(routes: Parameters<typeof mockFetch>[0], apiKey?: string) {
  const m = mockFetch(routes);
  const budget = new SubrequestBudget(45, m.fetch);
  return { src: new EthBlockscoutSource({ budget, prices, apiKey }), budget, calls: m.calls };
}

describe('EthBlockscoutSource.getProfile', () => {
  it('reads balance and counters with two v2 requests', async () => {
    const { src, budget, calls } = source([
      ['/counters', () => fixture('bs-counters-ronin.json')],
      [`/addresses/${RONIN}`, () => fixture('bs-address-ronin.json')],
    ]);
    const p = await src.getProfile(RONIN);
    expect(p.balance).toBeCloseTo(101.8089, 3);
    expect(p.txCount).toBe(430);
    expect(p.isContract).toBe(false);
    expect(p.nativeSymbol).toBe('ETH');
    expect(budget.used).toBe(2);
    expect(calls.every((c) => c.url.includes('/api/v2/'))).toBe(true);
  });
  it('returns an empty profile for an address Blockscout has never seen', async () => {
    const { src } = source([['/addresses/', () => json({ message: 'Not found' }, 404)]]);
    const p = await src.getProfile('0x0000000000000000000000000000000000000abc');
    expect(p.balance).toBe(0);
    expect(p.txCount).toBe(0);
  });
  it('labels the Tornado router from its contract name', async () => {
    const { src } = source([
      ['/counters', () => ({ transactions_count: '5' })],
      ['/addresses/', () => fixture('bs-address-tornado.json')],
    ]);
    const p = await src.getProfile('0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b');
    expect(p.isContract).toBe(true);
    expect(p.labels.some((l) => l.category === 'mixer')).toBe(true);
  });
  it('uses the per-key PRO API when an API key is configured', async () => {
    const { src, calls } = source([['/addresses/', () => fixture('bs-address-ronin.json')]], 'k1');
    await src.getProfile(RONIN);
    expect(calls.every((c) => c.url.startsWith('https://api.blockscout.com/1/api/v2/') && c.url.includes('apikey=k1'))).toBe(true);
  });
  it('uses the public instance without a key', async () => {
    const { src, calls } = source([['/addresses/', () => fixture('bs-address-ronin.json')]]);
    await src.getProfile(RONIN);
    expect(calls.every((c) => c.url.startsWith('https://eth.blockscout.com/api/v2/'))).toBe(true);
  });
});

describe('EthBlockscoutSource.getHistory', () => {
  async function history() {
    const ctx = source([
      ['/internal-transactions', () => emptyPage],
      ['/token-transfers', () => fixture('bs-tokentransfers-ronin.json')],
      ['/transactions', () => fixture('bs-v2-transactions-ronin.json')],
    ]);
    const h = await ctx.src.getHistory(RONIN, { limit: 200 });
    return { h, ...ctx };
  }

  it('normalizes native transfers and skips zero-value contract calls', async () => {
    const { h } = await history();
    const native = h.txs.filter((t) => t.kind === 'native');
    expect(native).toHaveLength(32);
    expect(native.filter((t) => t.direction === 'in')).toHaveLength(26);
    const first = native.find((t) => t.hash === '0xc9617ba91041a5730856dab8464328d7d6b7f12f060927cf3e6aa74759018f2b')!;
    expect(first.direction).toBe('in');
    expect(first.ts).toBe(1790861651);
    expect(first.block).toBe(26097794);
    expect(first.amount).toBeCloseTo(0.006438208349061858, 12);
    expect(first.usd).toBeCloseTo(0.006438208349061858 * 2500, 6);
    expect(first.counterparty).toBe('0x36b4ed9dcdc9bc05c712a0b4d9b904dc9fb1de7a');
  });

  it('drops unpriced spam tokens but keeps priced and zero-value transfers', async () => {
    const { h } = await history();
    const tokens = h.txs.filter((t) => t.kind === 'token');
    expect(tokens.length).toBe(4);
    expect(tokens.every((t) => t.usd !== undefined)).toBe(true);
    expect(tokens.some((t) => t.amount === 0 && t.direction === 'out')).toBe(true);
    expect(h.notes.join()).toContain('無報價');
  });

  it('collects counterparty labels from Blockscout tags and is_scam', async () => {
    const { h } = await history();
    expect(h.labels[PHISHER.toLowerCase()]?.some((l) => l.category === 'scam')).toBe(true);
  });

  it('marks the history as truncated when more pages exist and uses 3 subrequests', async () => {
    const { h, budget } = await history();
    expect(h.truncated).toBe(true);
    expect(budget.used).toBe(3);
  });

  it('reads internal transfers via transaction_hash', async () => {
    const { src } = source([
      ['/internal-transactions', () => fixture('bs-v2-internal-binance.json')],
      ['/token-transfers', () => emptyPage],
      ['/transactions', () => emptyPage],
    ]);
    const h = await src.getHistory(BINANCE, { limit: 200 });
    const internal = h.txs.filter((t) => t.kind === 'internal');
    expect(internal).toHaveLength(49);
    expect(internal.every((t) => /^0x[0-9a-f]{64}$/.test(t.hash))).toBe(true);
    expect(internal.every((t) => t.direction === 'in' || t.direction === 'out')).toBe(true);
  });
});

describe('EthBlockscoutSource.getCounterpartySnapshot', () => {
  it('lists the counterparties of an address with one request', async () => {
    const { src, budget } = source([['/transactions', () => fixture('bs-v2-transactions-ronin.json')]]);
    const snap = await src.getCounterpartySnapshot(RONIN);
    expect(snap.counterparties).toContain('0x36b4ed9dcdc9bc05c712a0b4d9b904dc9fb1de7a');
    expect(snap.counterparties).not.toContain(RONIN.toLowerCase());
    expect(budget.used).toBe(1);
  });
});

describe('EthBlockscoutSource degradation', () => {
  it('still returns history when internal transactions fail, with a note', async () => {
    const { src } = source([
      ['/internal-transactions', () => json({ message: 'timeout' }, 504)],
      ['/token-transfers', () => fixture('bs-tokentransfers-ronin.json')],
      ['/transactions', () => fixture('bs-v2-transactions-ronin.json')],
    ]);
    const h = await src.getHistory(RONIN, { limit: 200 });
    expect(h.txs.filter((t) => t.kind === 'native')).toHaveLength(32);
    expect(h.notes.join()).toContain('內部交易');
  });
  it('fails only when both transactions and token transfers fail', async () => {
    const { src } = source([['/', () => json({}, 503)]]);
    await expect(src.getHistory(RONIN, { limit: 200 })).rejects.toThrow();
  });
  it('returns a minimal profile when the address endpoint fails', async () => {
    const { src } = source([
      ['/counters', () => fixture('bs-counters-ronin.json')],
      ['/addresses/', () => json({}, 503)],
    ]);
    const p = await src.getProfile(RONIN);
    expect(p.balance).toBeUndefined();
    expect(p.txCount).toBe(430);
  });
});

