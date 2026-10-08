import { type AddressProfile, curatedLabels, type NormTx, rawToDecimal } from '@aml/engine';
import { fetchJson } from '../lib/http';
import type { AdapterDeps, CounterpartySnapshot, DataSource, FetchedHistory, HistoryOptions } from './types';

/**
 * Keyless BNB Smart Chain fallback through a public JSON-RPC node. Plain RPC has no
 * address-history index, so this reads ERC-20 `Transfer` logs of the main stablecoins and
 * WBNB over a recent block window (the node serves at most ~5,000 recent blocks). Native BNB
 * transfers are not visible and timestamps are estimated from block height.
 */
const RPC = 'https://bsc-rpc.publicnode.com';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** BSC block time since the Fermi hard fork (January 2026). */
export const BSC_BLOCK_SECONDS = 0.45;
/** Widen the window only while fewer than MIN_LOGS transfers were found (bounds CPU on busy wallets). */
const WINDOWS = [400, 1600, 5000];
const MIN_LOGS = 40;

const TOKENS: Record<string, { symbol: string; decimals: number; price: 'stable' | 'bnb' }> = {
  '0x55d398326f99059ff775485246999027b3197955': { symbol: 'BSC-USD', decimals: 18, price: 'stable' },
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDC', decimals: 18, price: 'stable' },
  '0xe9e7cea3dedca5984780bafc599bd69add087d56': { symbol: 'BUSD', decimals: 18, price: 'stable' },
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { symbol: 'WBNB', decimals: 18, price: 'bnb' },
};

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

interface RpcResponse<T> {
  id: number;
  result?: T;
  error?: { message: string };
}

const hex = (n: number) => `0x${n.toString(16)}`;
const topicAddress = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
const addressFromTopic = (t: string) => `0x${t.slice(-40).toLowerCase()}`;

export class BscPublicRpcSource implements DataSource {
  readonly chain = 'bsc' as const;
  readonly name = 'BSC 公開節點（publicnode）';
  readonly snapshotCost = 2;
  private head?: Promise<{ number: number; timestamp: number }>;

  constructor(private readonly deps: AdapterDeps) {}

  /** One JSON-RPC batch = one subrequest. */
  private async batch<T extends unknown[]>(calls: { method: string; params: unknown[] }[]): Promise<T> {
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, ...c }));
    const res = await fetchJson<RpcResponse<unknown>[] | RpcResponse<unknown>>(
      this.deps.budget,
      RPC,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 15_000 },
    );
    const list = (Array.isArray(res) ? res : [res]).sort((a, b) => a.id - b.id);
    return list.map((r) => {
      if (r.error) throw new Error(`BSC RPC: ${r.error.message}`);
      return r.result;
    }) as T;
  }

  private chainHead(): Promise<{ number: number; timestamp: number }> {
    this.head ??= this.batch<[{ number: string; timestamp: string }]>([
      { method: 'eth_getBlockByNumber', params: ['latest', false] },
    ]).then(([b]) => ({ number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) }));
    return this.head;
  }

  async getProfile(address: string): Promise<AddressProfile> {
    const [balanceHex, nonceHex] = await this.batch<[string, string]>([
      { method: 'eth_getBalance', params: [address, 'latest'] },
      { method: 'eth_getTransactionCount', params: [address, 'latest'] },
    ]);
    const balance = rawToDecimal(BigInt(balanceHex), 18);
    return {
      chain: 'bsc',
      address,
      nativeSymbol: 'BNB',
      balance,
      balanceUsd: balance * this.deps.prices.BNB,
      nonce: Number(BigInt(nonceHex)),
      labels: curatedLabels('bsc', address),
    };
  }

  private logsQuery(address: string, side: 'from' | 'to', fromBlock: number, toBlock: number) {
    const topic = topicAddress(address);
    return {
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: hex(fromBlock),
          toBlock: hex(toBlock),
          address: Object.keys(TOKENS),
          topics: side === 'from' ? [TRANSFER_TOPIC, topic] : [TRANSFER_TOPIC, null, topic],
        },
      ],
    };
  }

  async getHistory(address: string, _opts: HistoryOptions): Promise<FetchedHistory> {
    const head = await this.chainHead();
    let logs: RpcLog[] = [];
    let window = WINDOWS[0];
    for (window of WINDOWS) {
      const from = Math.max(0, head.number - window);
      const [out, inc] = await this.batch<[RpcLog[], RpcLog[]]>([
        this.logsQuery(address, 'from', from, head.number),
        this.logsQuery(address, 'to', from, head.number),
      ]);
      logs = [...out, ...inc];
      if (logs.length >= MIN_LOGS) break;
    }

    const subject = address.toLowerCase();
    const txs: NormTx[] = [];
    const seen = new Set<string>();
    for (const l of logs) {
      const token = TOKENS[l.address.toLowerCase()];
      if (!token || l.topics.length < 3) continue;
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = addressFromTopic(l.topics[1]);
      const to = addressFromTopic(l.topics[2]);
      const direction = from === subject ? (to === subject ? 'self' : 'out') : 'in';
      const raw = BigInt(l.data === '0x' ? '0x0' : l.data);
      const amount = rawToDecimal(raw, token.decimals);
      const block = Number(BigInt(l.blockNumber));
      txs.push({
        chain: 'bsc',
        hash: l.transactionHash,
        ts: Math.round(head.timestamp - (head.number - block) * BSC_BLOCK_SECONDS),
        block,
        direction,
        from,
        to,
        counterparty: direction === 'in' ? from : to,
        asset: { symbol: token.symbol, contract: l.address.toLowerCase(), decimals: token.decimals },
        amount,
        amountRaw: raw.toString(),
        usd: token.price === 'stable' ? amount : amount * this.deps.prices.BNB,
        kind: 'token',
        status: 'ok',
      });
    }
    const minutes = Math.max(1, Math.round((window * BSC_BLOCK_SECONDS) / 60));
    return {
      txs,
      truncated: true,
      labels: {},
      sources: [this.name],
      notes: [
        `BSC 備援資料來自公開節點：僅涵蓋最近約 ${minutes} 分鐘（${window.toLocaleString()} 個區塊）的 USDT／USDC／BUSD／WBNB 轉帳，未含 BNB 原生轉帳；交易時間依區塊高度估算。`,
      ],
    };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const head = await this.chainHead();
    const from = Math.max(0, head.number - WINDOWS[0]);
    const [out, inc] = await this.batch<[RpcLog[], RpcLog[]]>([
      this.logsQuery(address, 'from', from, head.number),
      this.logsQuery(address, 'to', from, head.number),
    ]);
    const self = address.toLowerCase();
    const set = new Set<string>();
    for (const l of [...out, ...inc]) {
      for (const t of l.topics.slice(1, 3)) {
        const a = addressFromTopic(t);
        if (a !== self) set.add(a);
      }
    }
    return { address, labels: curatedLabels('bsc', address), counterparties: [...set] };
  }
}
