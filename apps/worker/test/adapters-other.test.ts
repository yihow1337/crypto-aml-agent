import { describe, expect, it } from 'vitest';
import { BtcMempoolSource } from '../src/adapters/btc-mempool';
import { TronGridSource } from '../src/adapters/tron-trongrid';
import { SubrequestBudget } from '../src/lib/http';
import { FALLBACK_PRICES } from '../src/lib/prices';
import { fixture, mockFetch } from './helpers/fetch-mock';

const prices = { ...FALLBACK_PRICES, TRX: 0.25, BTC: 80_000, BNB: 600, source: 'fallback' as const };

function deps(routes: Parameters<typeof mockFetch>[0], extra: Record<string, unknown> = {}) {
  const m = mockFetch(routes);
  const budget = new SubrequestBudget(45, m.fetch);
  return { d: { budget, prices, ...extra }, budget, calls: m.calls };
}

describe('TronGridSource', () => {
  const A = 'TNaRAoLUyYEV2uF7GUrzSjRQTU8v5ZJ5VR';
  const routes: Parameters<typeof mockFetch>[0] = [
    ['/transactions/trc20', () => fixture('tg-trc20.json')],
    ['/transactions?', () => fixture('tg-transactions.json')],
    [`/v1/accounts/${A}`, () => fixture('tg-account.json')],
  ];

  it('reads balance and account timestamps', async () => {
    const { d } = deps(routes);
    const p = await new TronGridSource(d).getProfile(A);
    expect(p.balance).toBeCloseTo(14527.67625, 5);
    expect(p.firstSeen).toBe(1530168237);
    expect(p.lastSeen).toBe(1781299806);
    expect(p.nativeSymbol).toBe('TRX');
  });

  it('keeps TRX transfers (base58 addresses) and drops other contract types', async () => {
    const { d } = deps(routes);
    const h = await new TronGridSource(d).getHistory(A, { limit: 100 });
    const trx = h.txs.filter((t) => t.kind === 'native');
    expect(trx).toHaveLength(12);
    const t = trx.find((x) => x.hash.startsWith('4270cd48d2'))!;
    expect(t.direction).toBe('in');
    expect(t.counterparty.startsWith('T')).toBe(true);
    expect(t.amount).toBeCloseTo(0.005889, 6);
    expect(t.ts).toBe(1773226893);
  });

  it('keeps canonical and fake USDT transfers, drops approvals and spam tokens', async () => {
    const { d } = deps(routes);
    const h = await new TronGridSource(d).getHistory(A, { limit: 100 });
    const tokens = h.txs.filter((t) => t.kind === 'token');
    expect(tokens).toHaveLength(15 - 4 + 2);
    const fake = tokens.filter((t) => t.asset.contract === 'TQgktYKWXoVmGTJMMfJFDQxDDRyup9nDSt');
    expect(fake).toHaveLength(2);
    expect(fake.every((t) => t.usd === undefined)).toBe(true);
    const out = tokens.find((t) => t.counterparty.startsWith('TREnSa'))!;
    expect(out.direction).toBe('out');
    expect(out.usd).toBeCloseTo(620.907555, 6);
    expect(tokens.filter((t) => t.amount === 0)).toHaveLength(2);
  });

  it('sends the API key header when configured', async () => {
    const { d, calls } = deps(routes, { apiKey: 'k123' });
    await new TronGridSource(d).getProfile(A);
    expect((calls[0].init?.headers as Record<string, string>)['TRON-PRO-API-KEY']).toBe('k123');
  });
});

describe('BtcMempoolSource', () => {
  const A = '123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX';
  const routes: Parameters<typeof mockFetch>[0] = [
    [`/address/${A}/txs`, () => fixture('mp-txs.json')],
    [`/address/${A}`, () => fixture('mp-address.json')],
  ];

  it('computes balance from funded and spent outputs', async () => {
    const { d } = deps(routes);
    const p = await new BtcMempoolSource(d).getProfile(A);
    expect(p.balance).toBe(0);
    expect(p.txCount).toBe(2);
  });

  it('converts UTXO transactions into subject-relative transfers', async () => {
    const { d, budget } = deps(routes);
    const h = await new BtcMempoolSource(d).getHistory(A, { limit: 100 });
    expect(h.txs).toHaveLength(2);
    const received = h.txs.find((t) => t.hash.startsWith('e84eed72ad'))!;
    expect(received.direction).toBe('in');
    expect(received.amount).toBeCloseTo(27, 8);
    expect(received.btc?.nIn).toBe(100);
    const spent = h.txs.find((t) => t.hash.startsWith('d116b2dcba'))!;
    expect(spent.direction).toBe('out');
    expect(spent.amount).toBeCloseTo(27, 8);
    expect(spent.counterparty.startsWith('392XxH94')).toBe(true);
    expect(spent.usd).toBeCloseTo(27 * 80_000, 2);
    expect(h.truncated).toBe(false);
    expect(budget.used).toBe(1);
  });
});

