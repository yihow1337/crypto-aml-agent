import {
  type AddressProfile,
  curatedLabels,
  type NormTx,
  rawToDecimal,
  sanitizeText,
  tronHexToBase58,
} from '@aml/engine';
import { fetchJson } from '../lib/http';
import { decideToken, PRICE_NOTE, SPAM_NOTE } from './common';
import type { AdapterDeps, CounterpartySnapshot, DataSource, FetchedHistory, HistoryOptions } from './types';

const BASE = 'https://api.trongrid.io';

interface TgList<T> {
  data: T[];
  success?: boolean;
  meta?: { fingerprint?: string };
}

interface TgAccount {
  address: string;
  balance?: number;
  create_time?: number;
  latest_opration_time?: number;
}

interface TgTx {
  txID: string;
  block_timestamp: number;
  blockNumber?: number;
  ret?: { contractRet?: string }[];
  raw_data: {
    contract: { type: string; parameter: { value: { amount?: number; owner_address?: string; to_address?: string } } }[];
  };
}

interface TgTrc20 {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  type: string;
  token_info: { symbol?: string; address?: string; decimals?: number };
}

export class TronGridSource implements DataSource {
  readonly chain = 'tron' as const;
  readonly name = 'TronGrid (api.trongrid.io)';
  readonly snapshotCost = 1;

  constructor(private readonly deps: AdapterDeps) {}

  private get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.deps.apiKey) headers['TRON-PRO-API-KEY'] = this.deps.apiKey;
    return fetchJson<T>(this.deps.budget, `${BASE}${path}`, { headers });
  }

  async getProfile(address: string): Promise<AddressProfile> {
    const r = await this.get<TgList<TgAccount>>(`/v1/accounts/${address}`);
    const a = r.data?.[0];
    const balance = a?.balance ? a.balance / 1e6 : 0;
    return {
      chain: 'tron',
      address,
      nativeSymbol: 'TRX',
      balance,
      balanceUsd: balance * this.deps.prices.TRX,
      firstSeen: a?.create_time ? Math.floor(a.create_time / 1000) : undefined,
      lastSeen: a?.latest_opration_time ? Math.floor(a.latest_opration_time / 1000) : undefined,
      isContract: false,
      labels: curatedLabels('tron', address),
    };
  }

  async getHistory(address: string, opts: HistoryOptions): Promise<FetchedHistory> {
    const nativeN = Math.min(100, Math.max(10, opts.limit));
    const tokenN = Math.min(200, Math.max(20, opts.limit));
    const [native, trc20] = await Promise.all([
      this.get<TgList<TgTx>>(`/v1/accounts/${address}/transactions?limit=${nativeN}&only_confirmed=true`),
      this.get<TgList<TgTrc20>>(`/v1/accounts/${address}/transactions/trc20?limit=${tokenN}&only_confirmed=true`),
    ]);
    const txs: NormTx[] = [];
    const notes = [PRICE_NOTE];
    const price = this.deps.prices.TRX;

    for (const t of native.data ?? []) {
      const c = t.raw_data?.contract?.[0];
      if (!c || c.type !== 'TransferContract') continue;
      const v = c.parameter.value;
      if (!v.amount || !v.owner_address || !v.to_address) continue;
      const from = tronHexToBase58(v.owner_address);
      const to = tronHexToBase58(v.to_address);
      const direction = from === address ? (to === address ? 'self' : 'out') : 'in';
      const amount = v.amount / 1e6;
      txs.push({
        chain: 'tron',
        hash: t.txID,
        ts: Math.floor(t.block_timestamp / 1000),
        block: t.blockNumber,
        direction,
        from,
        to,
        counterparty: direction === 'in' ? from : to,
        asset: { symbol: 'TRX', decimals: 6 },
        amount,
        amountRaw: String(v.amount),
        usd: amount * price,
        kind: 'native',
        status: (t.ret?.[0]?.contractRet ?? 'SUCCESS') === 'SUCCESS' ? 'ok' : 'failed',
      });
    }

    let dropped = 0;
    for (const t of trc20.data ?? []) {
      if (t.type !== 'Transfer') continue;
      const info = t.token_info ?? {};
      if (!info.address || !info.symbol) {
        dropped++;
        continue;
      }
      const decision = decideToken('tron', info.symbol, info.address);
      if (!decision.keep) {
        dropped++;
        continue;
      }
      const decimals = info.decimals ?? 6;
      const amount = rawToDecimal(t.value, decimals);
      const direction = t.from === address ? (t.to === address ? 'self' : 'out') : 'in';
      txs.push({
        chain: 'tron',
        hash: t.transaction_id,
        ts: Math.floor(t.block_timestamp / 1000),
        direction,
        from: t.from,
        to: t.to,
        counterparty: direction === 'in' ? t.from : t.to,
        asset: { symbol: sanitizeText(info.symbol, 16), contract: info.address, decimals },
        amount,
        amountRaw: t.value,
        usd: decision.usdPerUnit !== undefined ? amount * decision.usdPerUnit : undefined,
        kind: 'token',
        status: 'ok',
      });
    }
    if (dropped > 0) notes.push(SPAM_NOTE);
    const truncated = (native.data?.length ?? 0) >= nativeN || (trc20.data?.length ?? 0) >= tokenN;
    return { txs, truncated, labels: {}, sources: [this.name], notes };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const r = await this.get<TgList<TgTrc20>>(`/v1/accounts/${address}/transactions/trc20?limit=50&only_confirmed=true`);
    const set = new Set<string>();
    for (const t of r.data ?? []) for (const a of [t.from, t.to]) if (a && a !== address) set.add(a);
    return { address, labels: curatedLabels('tron', address), counterparties: [...set] };
  }
}
