import {
  type AddressLabel,
  type AddressProfile,
  curatedLabels,
  isCanonicalStablecoin,
  isFakeStablecoin,
  type NormTx,
  normalizeAddress,
  sanitizeText,
} from '@aml/engine';
import { fetchJson } from '../lib/http';
import { labelsFromNames, SPAM_NOTE } from './common';
import {
  type AdapterDeps,
  addLabels,
  ChainUnavailableError,
  type CounterpartySnapshot,
  type DataSource,
  type FetchedHistory,
  type HistoryOptions,
} from './types';

const BASE = 'https://api.zerion.io/v1';

type EvmChain = 'eth' | 'bsc';

const CHAIN: Record<EvmChain, { id: string; native: string; name: string }> = {
  eth: { id: 'ethereum', native: 'ETH', name: 'Zerion API (Ethereum)' },
  bsc: { id: 'binance-smart-chain', native: 'BNB', name: 'Zerion API (BNB Smart Chain)' },
};

export const HISTORICAL_USD_NOTE = 'USD 金額採 Zerion 提供的交易當時價值。';

interface Quantity {
  int?: string;
  decimals?: number;
  float?: number;
  numeric?: string;
}

interface FungibleInfo {
  symbol?: string | null;
  implementations?: { chain_id: string; address: string | null; decimals?: number }[];
}

interface Transfer {
  direction: 'in' | 'out' | 'self';
  quantity: Quantity;
  value?: number | null;
  price?: number | null;
  sender: string;
  recipient: string;
  fungible_info?: FungibleInfo | null;
}

interface ZTransaction {
  attributes: {
    hash: string;
    mined_at: string;
    mined_at_block?: number;
    sent_from: string;
    sent_to: string | null;
    status: 'confirmed' | 'failed' | 'pending';
    operation_type?: string;
    transfers?: Transfer[];
    flags?: { is_trash?: boolean };
    application_metadata?: { name?: string | null; contract_address?: string | null } | null;
  };
}

interface ZPosition {
  attributes: { quantity: Quantity; value?: number | null; fungible_info?: FungibleInfo | null };
}

interface ZList<T> {
  links?: { next?: string | null };
  data: T[];
}

const amountOf = (q: Quantity) => Number(q.float ?? q.numeric ?? 0);

/**
 * Ethereum and BNB Smart Chain history through the Zerion API (keyed, so not affected by the
 * per-IP limits that hit public explorers from Cloudflare's shared egress). Each call counts
 * as one request against the daily allowance via `onCompute`.
 */
export class ZerionSource implements DataSource {
  readonly chain: EvmChain;
  readonly name: string;
  readonly snapshotCost = 1;

  constructor(
    chain: EvmChain,
    private readonly deps: AdapterDeps,
  ) {
    if (!deps.apiKey) throw new ChainUnavailableError('此鏈需要 Zerion API 金鑰（ZERION_API_KEY）');
    this.chain = chain;
    this.name = CHAIN[chain].name;
  }

  private get<T>(path: string, query: Record<string, string>): Promise<T> {
    this.deps.onCompute?.(1);
    const qs = new URLSearchParams({ currency: 'usd', 'filter[chain_ids]': CHAIN[this.chain].id, ...query }).toString();
    return fetchJson<T>(
      this.deps.budget,
      `${BASE}${path}?${qs}`,
      { headers: { Authorization: `Basic ${btoa(`${this.deps.apiKey}:`)}` } },
      { timeoutMs: 15_000, retryDelayMs: 1200 },
    );
  }

  private implementation(info: FungibleInfo | null | undefined) {
    return info?.implementations?.find((i) => i.chain_id === CHAIN[this.chain].id);
  }

  async getProfile(address: string): Promise<AddressProfile> {
    const r = await this.get<ZList<ZPosition>>(`/wallets/${address}/positions/`, {
      'filter[positions]': 'only_simple',
      'filter[trash]': 'only_non_trash',
      sort: 'value',
    });
    const native = r.data.find((p) => {
      const impl = this.implementation(p.attributes.fungible_info);
      return impl !== undefined && impl.address === null;
    });
    const balance = native ? amountOf(native.attributes.quantity) : 0;
    const price = this.chain === 'eth' ? this.deps.prices.ETH : this.deps.prices.BNB;
    return {
      chain: this.chain,
      address,
      nativeSymbol: CHAIN[this.chain].native,
      balance,
      balanceUsd: native?.attributes.value ?? balance * price,
      labels: curatedLabels(this.chain, address),
    };
  }

  async getHistory(address: string, opts: HistoryOptions): Promise<FetchedHistory> {
    const r = await this.get<ZList<ZTransaction>>(`/wallets/${address}/transactions/`, {
      'page[size]': String(Math.min(100, Math.max(10, opts.limit))),
      'filter[trash]': 'no_filter',
    });
    const subject = normalizeAddress(this.chain, address);
    const txs: NormTx[] = [];
    const labels: Record<string, AddressLabel[]> = {};
    let dropped = 0;

    for (const { attributes: a } of r.data ?? []) {
      if (a.status === 'pending') continue;
      const app = a.application_metadata;
      if (app?.name) {
        const appLabels = labelsFromNames([app.name], 'zerion');
        if (app.contract_address) addLabels(labels, app.contract_address.toLowerCase(), appLabels);
        if (a.sent_to) addLabels(labels, a.sent_to.toLowerCase(), appLabels);
      }
      const ts = Math.floor(Date.parse(a.mined_at) / 1000);
      const sentFrom = a.sent_from.toLowerCase();
      for (const t of a.transfers ?? []) {
        if (!t.fungible_info) continue; // NFTs
        const impl = this.implementation(t.fungible_info);
        const contract = impl?.address ? impl.address.toLowerCase() : undefined;
        const symbol = sanitizeText(t.fungible_info.symbol ?? '?', 16);
        const amount = amountOf(t.quantity);
        const isNative = impl !== undefined && impl.address === null;
        let usd: number | undefined;
        if (isNative) {
          usd = t.value ?? undefined;
        } else if (contract && isFakeStablecoin(this.chain, symbol, contract)) {
          usd = undefined; // keep for address-poisoning detection, never priced
        } else if (contract && isCanonicalStablecoin(this.chain, symbol, contract)) {
          usd = t.value ?? amount;
        } else if (t.value != null && !a.flags?.is_trash) {
          usd = t.value;
        } else {
          dropped++;
          continue;
        }
        const from = t.sender.toLowerCase();
        const to = t.recipient.toLowerCase();
        const direction = t.direction === 'self' || (from === subject && to === subject) ? 'self' : from === subject ? 'out' : 'in';
        txs.push({
          chain: this.chain,
          hash: a.hash,
          ts,
          block: a.mined_at_block,
          direction,
          from,
          to,
          counterparty: direction === 'in' ? from : to,
          asset: { symbol, contract, decimals: t.quantity.decimals ?? impl?.decimals ?? 18 },
          amount,
          amountRaw: t.quantity.int,
          usd,
          kind: isNative ? (from !== sentFrom ? 'internal' : 'native') : 'token',
          status: a.status === 'failed' ? 'failed' : 'ok',
          method: a.operation_type ? sanitizeText(a.operation_type, 24) : undefined,
        });
      }
    }
    const notes = [HISTORICAL_USD_NOTE];
    if (dropped > 0) notes.push(SPAM_NOTE);
    return { txs, truncated: Boolean(r.links?.next), labels, sources: [this.name], notes };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const r = await this.get<ZList<ZTransaction>>(`/wallets/${address}/transactions/`, {
      'page[size]': '50',
      'filter[trash]': 'only_non_trash',
    });
    const self = normalizeAddress(this.chain, address);
    const set = new Set<string>();
    for (const { attributes: a } of r.data ?? []) {
      for (const x of [a.sent_from, a.sent_to, ...(a.transfers ?? []).flatMap((t) => [t.sender, t.recipient])]) {
        if (x && x.toLowerCase() !== self) set.add(x.toLowerCase());
      }
    }
    return { address, labels: curatedLabels(this.chain, address), counterparties: [...set] };
  }
}
