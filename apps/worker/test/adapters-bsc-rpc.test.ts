import { describe, expect, it } from 'vitest';
import { BscPublicRpcSource } from '../src/adapters/bsc-public-rpc';
import { SubrequestBudget } from '../src/lib/http';
import { FALLBACK_PRICES } from '../src/lib/prices';
import { mockFetch } from './helpers/fetch-mock';

const S = '0x8894e0a0c962cb723c1976a4421c95949be2d4e3';
const PAD = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const OTHER = '0x2222222222222222222222222222222222222222';
const LATEST = 1_000_000;
const LATEST_TS = 1_790_000_000;
const prices = { ...FALLBACK_PRICES, BNB: 700, source: 'fallback' as const };

interface RpcCall {
  method: string;
  params: unknown[];
  id: number;
}

function log(token: string, from: string, to: string, valueWei: bigint, block: number, i: number) {
  return {
    address: token,
    topics: [TRANSFER, PAD(from), PAD(to)],
    data: `0x${valueWei.toString(16).padStart(64, '0')}`,
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: `0x${i.toString(16).padStart(64, '0')}`,
    logIndex: '0x0',
  };
}

/** Fake JSON-RPC node: answers batches; getLogs returns `logsFor(fromBlock, side)`. */
function node(logsFor: (fromBlock: number, side: 'from' | 'to') => unknown[]) {
  const ranges: number[] = [];
  const m = mockFetch([
    ['publicnode.com', (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RpcCall | RpcCall[];
      const answer = (c: RpcCall) => {
        switch (c.method) {
          case 'eth_getBlockByNumber':
            return { jsonrpc: '2.0', id: c.id, result: { number: `0x${LATEST.toString(16)}`, timestamp: `0x${LATEST_TS.toString(16)}` } };
          case 'eth_getBalance':
            return { jsonrpc: '2.0', id: c.id, result: '0x1bc16d674ec80000' };
          case 'eth_getTransactionCount':
            return { jsonrpc: '2.0', id: c.id, result: '0x10' };
          case 'eth_getLogs': {
            const f = c.params[0] as { fromBlock: string; topics: (string | null)[] };
            const from = Number.parseInt(f.fromBlock, 16);
            const side = f.topics[1] ? 'from' : 'to';
            if (side === 'from') ranges.push(LATEST - from);
            return { jsonrpc: '2.0', id: c.id, result: logsFor(from, side) };
          }
          default:
            return { jsonrpc: '2.0', id: c.id, error: { message: 'unsupported' } };
        }
      };
      return Array.isArray(body) ? body.map(answer) : answer(body);
    }],
  ]);
  const budget = new SubrequestBudget(45, m.fetch);
  return { src: new BscPublicRpcSource({ budget, prices }), budget, ranges };
}

describe('BscPublicRpcSource', () => {
  it('reads balance and nonce in one batched request plus the chain head', async () => {
    const { src, budget } = node(() => []);
    const p = await src.getProfile(S);
    expect(p.balance).toBe(2);
    expect(p.balanceUsd).toBe(1400);
    expect(p.nonce).toBe(16);
    expect(p.nativeSymbol).toBe('BNB');
    expect(budget.used).toBeLessThanOrEqual(2);
  });

  it('normalizes recent BEP-20 transfers with estimated timestamps and prices', async () => {
    const { src } = node((_from, side) =>
      side === 'from'
        ? Array.from({ length: 30 }, (_, i) => log(USDT, S, OTHER, 5n * 10n ** 18n, LATEST - 10, i))
        : Array.from({ length: 30 }, (_, i) => log(WBNB, OTHER, S, 10n ** 18n, LATEST - 100, 100 + i)),
    );
    const h = await src.getHistory(S, { limit: 200 });
    const out = h.txs.find((t) => t.direction === 'out')!;
    expect(out).toMatchObject({ chain: 'bsc', kind: 'token', amount: 5, usd: 5, counterparty: OTHER });
    expect(out.asset.symbol).toBe('BSC-USD');
    expect(Math.abs(out.ts - (LATEST_TS - 10 * 0.45))).toBeLessThanOrEqual(1);
    const inn = h.txs.find((t) => t.direction === 'in')!;
    expect(inn.usd).toBe(700);
    expect(h.truncated).toBe(true);
    expect(h.notes.join()).toContain('公開節點');
  });

  it('widens the block window only while too few transfers are found', async () => {
    const quiet = node(() => []);
    await quiet.src.getHistory(S, { limit: 200 });
    expect(quiet.ranges).toEqual([400, 1600, 5000]);

    const busy = node((_f, side) => (side === 'from' ? Array.from({ length: 60 }, (_, i) => log(USDT, S, OTHER, 10n ** 18n, LATEST - 5, i)) : []));
    await busy.src.getHistory(S, { limit: 200 });
    expect(busy.ranges).toEqual([400]);
  });

  it('lists counterparties for tracing', async () => {
    const { src } = node((_f, side) => (side === 'to' ? [log(USDT, OTHER, S, 10n ** 18n, LATEST - 1, 1)] : []));
    const snap = await src.getCounterpartySnapshot(S);
    expect(snap.counterparties).toEqual([OTHER]);
  });
});
