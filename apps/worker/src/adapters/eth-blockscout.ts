import {
  type AddressLabel,
  type AddressProfile,
  curatedLabels,
  type NormTx,
  normalizeAddress,
  rawToDecimal,
  sanitizeText,
} from '@aml/engine';
import { BudgetExceededError, fetchJson, type FetchJsonOptions, UpstreamError } from '../lib/http';
import { type BlockscoutParty, decideToken, labelsFromBlockscoutParty, PRICE_NOTE, SPAM_NOTE } from './common';
import {
  type AdapterDeps,
  addLabels,
  type CounterpartySnapshot,
  type DataSource,
  type FetchedHistory,
  type HistoryOptions,
} from './types';

/**
 * Blockscout REST v2 only (the Etherscan-style `/api?module=…` endpoints allow just 10 req/min).
 * Anonymous limits are per IP and Cloudflare Workers share egress IPs, so production should set
 * BLOCKSCOUT_API_KEY to use the PRO API, which is rate-limited per key instead.
 */
const PUBLIC_BASE = 'https://eth.blockscout.com/api/v2';
const PRO_BASE = 'https://api.blockscout.com/1/api/v2';

interface V2Page<T> {
  items: T[];
  next_page_params: unknown;
}

interface V2Address extends BlockscoutParty {
  coin_balance: string | null;
  exchange_rate: string | null;
  is_contract: boolean;
}

interface V2Tx {
  hash: string;
  timestamp: string | null;
  block_number: number | null;
  value: string;
  status: 'ok' | 'error' | null;
  method: string | null;
  from: BlockscoutParty;
  to: BlockscoutParty | null;
}

interface V2Internal {
  transaction_hash: string;
  timestamp: string | null;
  block_number: number;
  value: string;
  success: boolean;
  from: BlockscoutParty;
  to: BlockscoutParty | null;
}

interface V2TokenTransfer {
  transaction_hash: string;
  block_number: number;
  timestamp: string | null;
  method?: string | null;
  from: BlockscoutParty;
  to: BlockscoutParty;
  total: { value: string; decimals: string | null } | null;
  token: { address_hash: string; symbol: string | null; decimals: string | null; exchange_rate: string | null; type: string };
}

const toTs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export class EthBlockscoutSource implements DataSource {
  readonly chain = 'eth' as const;
  readonly name = 'Blockscout (eth.blockscout.com)';
  readonly snapshotCost = 1;

  constructor(private readonly deps: AdapterDeps) {}

  private url(path: string): string {
    if (!this.deps.apiKey) return `${PUBLIC_BASE}${path}`;
    return `${PRO_BASE}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(this.deps.apiKey)}`;
  }

  private async getOrNull<T>(path: string, opts?: FetchJsonOptions): Promise<T | null> {
    try {
      return await fetchJson<T>(this.deps.budget, this.url(path), undefined, opts);
    } catch (e) {
      if (e instanceof UpstreamError && (e.status === 404 || e.status === 422)) return null;
      throw e;
    }
  }

  /** Like getOrNull but never throws (except on budget exhaustion); `failed` reports errors. */
  private async optional<T>(path: string, opts?: FetchJsonOptions): Promise<{ value: T | null; failed: boolean }> {
    try {
      return { value: await this.getOrNull<T>(path, opts), failed: false };
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      console.warn(`blockscout ${path.split('?')[0]} failed: ${(e as Error).message}`);
      return { value: null, failed: true };
    }
  }

  async getProfile(address: string): Promise<AddressProfile> {
    // The address endpoint can take >15 s for very busy addresses; degrade to an unknown balance.
    const [infoR, countersR] = await Promise.all([
      this.optional<V2Address>(`/addresses/${address}`, { timeoutMs: 12_000, retries: 0 }),
      this.optional<{ transactions_count?: string }>(`/addresses/${address}/counters`),
    ]);
    const info = infoR.value;
    const counters = countersR.value;
    const balance = infoR.failed ? undefined : info?.coin_balance ? rawToDecimal(info.coin_balance, 18) : 0;
    const rate = info?.exchange_rate ? Number(info.exchange_rate) : this.deps.prices.ETH;
    return {
      chain: 'eth',
      address,
      nativeSymbol: 'ETH',
      balance,
      balanceUsd: balance === undefined ? undefined : balance * rate,
      txCount: counters?.transactions_count ? Number(counters.transactions_count) : 0,
      isContract: info?.is_contract ?? false,
      labels: [...curatedLabels('eth', address), ...labelsFromBlockscoutParty(info)],
    };
  }

  async getHistory(address: string, _opts: HistoryOptions): Promise<FetchedHistory> {
    // Internal transactions are slow (20 s+) for busy addresses: optional with a short timeout.
    const [txR, tokenR, internalR] = await Promise.all([
      this.optional<V2Page<V2Tx>>(`/addresses/${address}/transactions`, { timeoutMs: 15_000 }),
      this.optional<V2Page<V2TokenTransfer>>(`/addresses/${address}/token-transfers?type=ERC-20`, { timeoutMs: 15_000 }),
      this.optional<V2Page<V2Internal>>(`/addresses/${address}/internal-transactions`, { timeoutMs: 8_000, retries: 0 }),
    ]);
    if (txR.failed && tokenR.failed) throw new UpstreamError(502, PUBLIC_BASE, 'Blockscout 交易與代幣轉帳查詢皆失敗（可能遭限流，請稍後再試）');
    const txPage = txR.value;
    const tokenPage = tokenR.value;
    const internalPage = internalR.value;
    const subject = normalizeAddress('eth', address);
    const price = this.deps.prices.ETH;
    const txs: NormTx[] = [];
    const labels: Record<string, AddressLabel[]> = {};
    const notes = [PRICE_NOTE];
    if (txR.failed) notes.push('一般交易查詢失敗，僅分析代幣轉帳。');
    if (tokenR.failed) notes.push('代幣轉帳查詢失敗，僅分析原生 ETH 交易。');
    if (internalR.failed) notes.push('內部交易（合約轉出 ETH）查詢逾時，未納入分析。');

    const push = (p: {
      hash: string;
      timestamp: string;
      block: number | null;
      from: BlockscoutParty;
      to: BlockscoutParty | null;
      value: string;
      ok: boolean;
      kind: 'native' | 'internal';
      method?: string | null;
    }) => {
      const from = p.from.hash.toLowerCase();
      const to = (p.to?.hash ?? '').toLowerCase();
      addLabels(labels, from, labelsFromBlockscoutParty(p.from));
      if (p.to) addLabels(labels, to, labelsFromBlockscoutParty(p.to));
      if (!p.value || p.value === '0') return;
      const direction = from === subject ? (to === subject ? 'self' : 'out') : 'in';
      const amount = rawToDecimal(p.value, 18);
      txs.push({
        chain: 'eth',
        hash: p.hash,
        ts: toTs(p.timestamp),
        block: p.block ?? undefined,
        direction,
        from,
        to,
        counterparty: direction === 'in' ? from : to,
        asset: { symbol: 'ETH', decimals: 18 },
        amount,
        amountRaw: p.value,
        usd: amount * price,
        kind: p.kind,
        status: p.ok ? 'ok' : 'failed',
        method: p.method ? sanitizeText(p.method, 32) : undefined,
      });
    };

    for (const t of txPage?.items ?? []) {
      if (!t.timestamp) continue; // pending
      push({ hash: t.hash, timestamp: t.timestamp, block: t.block_number, from: t.from, to: t.to, value: t.value, ok: t.status !== 'error', kind: 'native', method: t.method });
    }
    for (const t of internalPage?.items ?? []) {
      if (!t.timestamp) continue;
      push({ hash: t.transaction_hash, timestamp: t.timestamp, block: t.block_number, from: t.from, to: t.to, value: t.value, ok: t.success, kind: 'internal' });
    }

    let dropped = 0;
    for (const t of tokenPage?.items ?? []) {
      if (!t.timestamp || !t.total || t.token.type !== 'ERC-20') continue;
      addLabels(labels, t.from.hash.toLowerCase(), labelsFromBlockscoutParty(t.from));
      addLabels(labels, t.to.hash.toLowerCase(), labelsFromBlockscoutParty(t.to));
      const decision = decideToken('eth', t.token.symbol ?? '', t.token.address_hash, t.token.exchange_rate ? Number(t.token.exchange_rate) : null);
      if (!decision.keep) {
        dropped++;
        continue;
      }
      const decimals = Number(t.total.decimals ?? t.token.decimals ?? 18);
      const amount = rawToDecimal(t.total.value, decimals);
      const from = t.from.hash.toLowerCase();
      const to = t.to.hash.toLowerCase();
      const direction = from === subject ? (to === subject ? 'self' : 'out') : 'in';
      txs.push({
        chain: 'eth',
        hash: t.transaction_hash,
        ts: toTs(t.timestamp),
        block: t.block_number,
        direction,
        from,
        to,
        counterparty: direction === 'in' ? from : to,
        asset: { symbol: sanitizeText(t.token.symbol ?? '?', 16), contract: t.token.address_hash.toLowerCase(), decimals },
        amount,
        amountRaw: t.total.value,
        usd: decision.usdPerUnit !== undefined ? amount * decision.usdPerUnit : undefined,
        kind: 'token',
        status: 'ok',
        method: t.method ? sanitizeText(t.method, 32) : undefined,
      });
    }
    if (dropped > 0) notes.push(SPAM_NOTE);

    const truncated = Boolean(txPage?.next_page_params || tokenPage?.next_page_params || internalPage?.next_page_params);
    return { txs, truncated, labels, sources: [this.name], notes };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const page = await this.getOrNull<V2Page<V2Tx>>(`/addresses/${address}/transactions`);
    const self = normalizeAddress('eth', address);
    const set = new Set<string>();
    for (const t of page?.items ?? []) {
      for (const a of [t.from?.hash, t.to?.hash]) if (a && a.toLowerCase() !== self) set.add(a.toLowerCase());
    }
    return { address, labels: curatedLabels('eth', address), counterparties: [...set] };
  }
}
