import { describe, expect, it } from 'vitest';
import { ZerionSource } from '../src/adapters/zerion';
import { SubrequestBudget } from '../src/lib/http';
import { FALLBACK_PRICES } from '../src/lib/prices';
import { fixture, mockFetch } from './helpers/fetch-mock';

const S = '0x5000000000000000000000000000000000000005';
const prices = { ...FALLBACK_PRICES, ETH: 2000, BNB: 700, source: 'fallback' as const };

function deps(routes: Parameters<typeof mockFetch>[0], extra: Record<string, unknown> = {}) {
  const m = mockFetch(routes);
  const budget = new SubrequestBudget(45, m.fetch);
  let used = 0;
  const d = { budget, prices, apiKey: 'zk_test', onCompute: (u: number) => (used += u), ...extra };
  return { d, budget, calls: m.calls, used: () => used };
}

describe('ZerionSource', () => {
  it('refuses to run without an API key', () => {
    const { d } = deps([], { apiKey: undefined });
    expect(() => new ZerionSource('bsc', d)).toThrow(/Zerion/);
  });

  it('reads the native balance from wallet positions using Basic auth', async () => {
    const { d, calls, used } = deps([['/positions/', () => fixture('zerion-positions.json')]]);
    const p = await new ZerionSource('eth', d).getProfile(S);
    expect(p.balance).toBe(2);
    expect(p.balanceUsd).toBe(5000);
    expect(p.nativeSymbol).toBe('ETH');
    expect(calls[0].url.startsWith(`https://api.zerion.io/v1/wallets/${S}/positions/`)).toBe(true);
    expect(decodeURIComponent(calls[0].url)).toContain('filter[chain_ids]=ethereum');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('zk_test:')}`);
    expect(used()).toBe(1);
  });

  it('normalizes transfers with historical USD values', async () => {
    const { d, budget, used } = deps([['/transactions/', () => fixture('zerion-transactions.json')]]);
    const h = await new ZerionSource('eth', d).getHistory(S, { limit: 100 });
    const byHash = (c: string) => h.txs.filter((t) => t.hash === `0x${c.repeat(64)}`);

    const fromBinance = byHash('a')[0];
    expect(fromBinance).toMatchObject({ direction: 'in', amount: 1, usd: 2400.5, kind: 'native', block: 23000000 });
    expect(fromBinance.counterparty).toBe('0x28c6c06298d514db089934071355e5743bf21d60');
    expect(fromBinance.ts).toBe(Date.parse('2026-09-01T10:00:00Z') / 1000);

    const tornado = byHash('b')[0];
    expect(tornado.kind).toBe('internal');
    expect(tornado.counterparty).toBe('0x910cbd523d972eb0a6f4cae4618ad62622b39dbf');

    const usdt = byHash('c')[0];
    expect(usdt).toMatchObject({ kind: 'token', direction: 'out', usd: 4999 });
    expect(usdt.asset.contract).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');

    expect(byHash('d')).toHaveLength(0);
    const fake = byHash('e')[0];
    expect(fake.asset.symbol).toBe('USDT');
    expect(fake.usd).toBeUndefined();
    expect(byHash('f')[0].status).toBe('failed');
    expect(byHash('7')[0]).toMatchObject({ amount: 0, usd: 0 });
    expect(byHash('8')).toHaveLength(0);
    expect(byHash('9')).toHaveLength(0);

    expect(h.truncated).toBe(true);
    expect(h.labels['0xd90e2f925da726b50c4ed8d0fb90ad053324f31b'].some((l) => l.category === 'mixer')).toBe(true);
    expect(h.notes.join()).toContain('交易當時');
    expect(budget.used).toBe(1);
    expect(used()).toBe(1);
  });

  it('queries the BNB Smart Chain id for BSC', async () => {
    const { d, calls } = deps([['/transactions/', () => ({ links: {}, data: [] })]]);
    const h = await new ZerionSource('bsc', d).getHistory(S, { limit: 100 });
    expect(decodeURIComponent(calls[0].url)).toContain('filter[chain_ids]=binance-smart-chain');
    expect(h.truncated).toBe(false);
  });

  it('lists counterparties for tracing with one request', async () => {
    const { d, calls } = deps([['/transactions/', () => fixture('zerion-transactions.json')]]);
    const snap = await new ZerionSource('eth', d).getCounterpartySnapshot(S);
    expect(snap.counterparties).toContain('0x28c6c06298d514db089934071355e5743bf21d60');
    expect(snap.counterparties).toContain('0x910cbd523d972eb0a6f4cae4618ad62622b39dbf');
    expect(snap.counterparties).not.toContain(S);
    expect(decodeURIComponent(calls[0].url)).toContain('page[size]=50');
  });
});

describe('ZerionSource untrackable addresses', () => {
  it('raises UntrackableAddressError when Zerion refuses to track an address', async () => {
    const { UntrackableAddressError } = await import('../src/adapters/zerion');
    const { d } = deps([['/transactions/', () => new Response(JSON.stringify({ errors: [{ title: 'Malformed parameter was sent', detail: 'untrackable wallet address' }] }), { status: 400 })]]);
    await expect(new ZerionSource('bsc', d).getHistory(S, { limit: 100 })).rejects.toBeInstanceOf(UntrackableAddressError);
  });
});
