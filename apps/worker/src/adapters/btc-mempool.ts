import { type AddressProfile, curatedLabels, type NormTx } from '@aml/engine';
import { fetchJson } from '../lib/http';
import { PRICE_NOTE } from './common';
import type { AdapterDeps, CounterpartySnapshot, DataSource, FetchedHistory, HistoryOptions } from './types';

const BASE = 'https://mempool.space/api';
const PAGE = 25;
const SATS = 1e8;

interface EsploraStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

interface EsploraAddress {
  address: string;
  chain_stats: EsploraStats;
  mempool_stats: EsploraStats;
}

interface EsploraTx {
  txid: string;
  vin: { is_coinbase?: boolean; prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

/** Convert an Esplora transaction into a transfer relative to `subject`. Returns null if unconfirmed. */
export function convertEsploraTx(t: EsploraTx, subject: string, price: number): NormTx | null {
  if (!t.status.confirmed || !t.status.block_time) return null;
  const inputs = t.vin
    .filter((v) => !v.is_coinbase && v.prevout)
    .map((v) => ({ addr: v.prevout!.scriptpubkey_address ?? 'unknown', value: v.prevout!.value / SATS }));
  const outputs = t.vout.map((v) => ({ addr: v.scriptpubkey_address ?? 'OP_RETURN', value: v.value / SATS }));
  const spent = inputs.filter((u) => u.addr === subject).reduce((s, u) => s + u.value, 0);
  const received = outputs.filter((u) => u.addr === subject).reduce((s, u) => s + u.value, 0);
  const net = Number((received - spent).toFixed(8));
  const others = (net >= 0 ? inputs : outputs).filter((u) => u.addr !== subject).sort((a, b) => b.value - a.value);
  const direction = others.length === 0 ? 'self' : net >= 0 ? 'in' : 'out';
  const counterparty = others[0]?.addr ?? subject;
  const amount = Math.abs(net);
  return {
    chain: 'btc',
    hash: t.txid,
    ts: t.status.block_time,
    block: t.status.block_height,
    direction,
    from: direction === 'in' ? counterparty : subject,
    to: direction === 'in' ? subject : counterparty,
    counterparty,
    asset: { symbol: 'BTC', decimals: 8 },
    amount,
    usd: amount * price,
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

export class BtcMempoolSource implements DataSource {
  readonly chain = 'btc' as const;
  readonly name = 'mempool.space';
  readonly snapshotCost = 1;

  constructor(private readonly deps: AdapterDeps) {}

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(this.deps.budget, `${BASE}${path}`);
  }

  async getProfile(address: string): Promise<AddressProfile> {
    const a = await this.get<EsploraAddress>(`/address/${address}`);
    const sats =
      a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum + a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
    const balance = sats / SATS;
    return {
      chain: 'btc',
      address,
      nativeSymbol: 'BTC',
      balance,
      balanceUsd: balance * this.deps.prices.BTC,
      txCount: a.chain_stats.tx_count + a.mempool_stats.tx_count,
      isContract: false,
      labels: curatedLabels('btc', address),
    };
  }

  async getHistory(address: string, opts: HistoryOptions): Promise<FetchedHistory> {
    const maxPages = Math.max(1, Math.ceil(Math.min(100, opts.limit) / PAGE));
    const raw: EsploraTx[] = [];
    let page = await this.get<EsploraTx[]>(`/address/${address}/txs`);
    raw.push(...page);
    let confirmedOnPage = page.filter((t) => t.status.confirmed).length;
    for (let i = 1; i < maxPages && confirmedOnPage >= PAGE; i++) {
      const last = raw.filter((t) => t.status.confirmed).at(-1)!;
      page = await this.get<EsploraTx[]>(`/address/${address}/txs/chain/${last.txid}`);
      raw.push(...page);
      confirmedOnPage = page.length;
    }
    const txs = raw
      .map((t) => convertEsploraTx(t, address, this.deps.prices.BTC))
      .filter((t): t is NormTx => t !== null);
    return {
      txs,
      truncated: confirmedOnPage >= PAGE,
      labels: {},
      sources: [this.name],
      notes: [PRICE_NOTE],
    };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const txs = await this.get<EsploraTx[]>(`/address/${address}/txs`);
    const set = new Set<string>();
    for (const t of txs) {
      for (const v of t.vin) if (v.prevout?.scriptpubkey_address) set.add(v.prevout.scriptpubkey_address);
      for (const v of t.vout) if (v.scriptpubkey_address) set.add(v.scriptpubkey_address);
    }
    set.delete(address);
    return { address, labels: curatedLabels('btc', address), counterparties: [...set] };
  }
}
