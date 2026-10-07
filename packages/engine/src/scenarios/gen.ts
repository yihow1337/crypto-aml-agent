import { bech32 } from '@scure/base';
import { toChecksumAddress, tronHexToBase58 } from '../address';
import { mulberry32, seedFromString } from '../ml/rng';
import type { AddressProfile, Chain, NormTx } from '../types';

/** Fixed clock so scenarios are reproducible: 2026-09-21T12:53:20Z. */
export const SCENARIO_NOW = 1_790_000_000;
export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;

export const PRICES: Record<string, number> = {
  ETH: 2500,
  BNB: 600,
  TRX: 0.25,
  BTC: 60_000,
  USDT: 1,
  USDC: 1,
  'BSC-USD': 1,
};

const NATIVE: Record<Chain, string> = { eth: 'ETH', bsc: 'BNB', tron: 'TRX', btc: 'BTC' };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Seeded generator for synthetic-but-realistic addresses, hashes and amounts. */
export class Gen {
  private readonly rnd: () => number;
  constructor(seed: string) {
    this.rnd = mulberry32(seedFromString(seed));
  }
  next(): number {
    return this.rnd();
  }
  between(a: number, b: number): number {
    return a + this.rnd() * (b - a);
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.rnd() * (b - a + 1));
  }
  /** Amount with `decimals` fractional digits (avoids accidental round numbers). */
  amount(a: number, b: number, decimals = 4): number {
    const v = Number(this.between(a, b).toFixed(decimals));
    return Number.isInteger(v) ? v + 1 / 10 ** decimals : v;
  }
  hex(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(this.rnd() * 16)];
    return s;
  }
  bytes(n: number): Uint8Array {
    return Uint8Array.from({ length: n }, () => Math.floor(this.rnd() * 256));
  }
  address(chain: Chain): string {
    if (chain === 'tron') return tronHexToBase58(`41${this.hex(40)}`);
    if (chain === 'btc') return bech32.encode('bc', [0, ...bech32.toWords(this.bytes(20))]);
    return toChecksumAddress(`0x${this.hex(40)}`);
  }
  /** An address sharing the first and last 4 body characters with `real` (address poisoning). */
  lookalike(chain: Chain, real: string): string {
    if (chain === 'tron') {
      let mid = '';
      for (let i = 0; i < 25; i++) mid += B58[Math.floor(this.rnd() * B58.length)];
      return `${real.slice(0, 5)}${mid}${real.slice(-4)}`;
    }
    const body = real.slice(2).toLowerCase();
    return toChecksumAddress(`0x${body.slice(0, 4)}${this.hex(32)}${body.slice(-4)}`);
  }
  hash(chain: Chain): string {
    return chain === 'eth' || chain === 'bsc' ? `0x${this.hex(64)}` : this.hex(64);
  }
}

export interface AcctSpec {
  dir: 'in' | 'out';
  cp: string;
  amount: number;
  ts: number;
  symbol?: string;
  contract?: string;
  decimals?: number;
  /** Override USD value; `null` means no price (e.g. a fake token). */
  usd?: number | null;
}

export function acctTx(g: Gen, chain: Chain, subject: string, s: AcctSpec): NormTx {
  const symbol = s.symbol ?? NATIVE[chain];
  const native = !s.contract;
  const price = PRICES[symbol];
  const usd = s.usd === null ? undefined : (s.usd ?? (price !== undefined ? s.amount * price : undefined));
  return {
    chain,
    hash: g.hash(chain),
    ts: s.ts,
    direction: s.dir,
    from: s.dir === 'in' ? s.cp : subject,
    to: s.dir === 'in' ? subject : s.cp,
    counterparty: s.cp,
    asset: { symbol, contract: s.contract, decimals: s.decimals ?? (native ? (chain === 'tron' ? 6 : 18) : 6) },
    amount: s.amount,
    usd: usd === undefined ? undefined : Math.round(usd * 100) / 100,
    kind: native ? 'native' : 'token',
    status: 'ok',
  };
}

export interface Utxo {
  addr: string;
  value: number;
}

export function btcTx(g: Gen, subject: string, ts: number, inputs: Utxo[], outputs: Utxo[]): NormTx {
  const mine = (u: Utxo) => u.addr === subject;
  const spent = inputs.filter(mine).reduce((s, u) => s + u.value, 0);
  const received = outputs.filter(mine).reduce((s, u) => s + u.value, 0);
  const net = Number((received - spent).toFixed(8));
  const direction = net >= 0 ? 'in' : 'out';
  const others = (direction === 'in' ? inputs : outputs).filter((u) => !mine(u)).sort((a, b) => b.value - a.value);
  const counterparty = others[0]?.addr ?? subject;
  const amount = Math.abs(net);
  return {
    chain: 'btc',
    hash: g.hash('btc'),
    ts,
    direction,
    from: direction === 'in' ? counterparty : subject,
    to: direction === 'in' ? subject : counterparty,
    counterparty,
    asset: { symbol: 'BTC', decimals: 8 },
    amount,
    usd: Math.round(amount * PRICES.BTC * 100) / 100,
    kind: 'native',
    status: 'ok',
    btc: {
      nIn: inputs.length,
      nOut: outputs.length,
      inputAddrs: inputs.map((u) => u.addr),
      outputAddrs: outputs.map((u) => u.addr),
      outValues: outputs.map((u) => u.value),
      subjectNet: net,
    },
  };
}

export function profileFor(chain: Chain, address: string, txs: NormTx[], extra: Partial<AddressProfile> = {}): AddressProfile {
  let balance = 0;
  for (const t of txs) if (!t.asset.contract) balance += t.direction === 'in' ? t.amount : t.direction === 'out' ? -t.amount : 0;
  const ts = txs.map((t) => t.ts);
  const price = PRICES[NATIVE[chain]];
  const bal = Math.max(0, Number(balance.toFixed(8)));
  return {
    chain,
    address,
    nativeSymbol: NATIVE[chain],
    balance: bal,
    balanceUsd: Math.round(bal * price * 100) / 100,
    txCount: txs.length,
    firstSeen: Math.min(...ts),
    lastSeen: Math.max(...ts),
    isContract: false,
    labels: [],
    ...extra,
  };
}
