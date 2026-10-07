import type { AddressLabel, AddressProfile, Chain, NormTx } from '@aml/engine';
import type { SubrequestBudget } from '../lib/http';
import type { PriceTable } from '../lib/prices';

export interface HistoryOptions {
  limit: number;
}

export interface FetchedHistory {
  txs: NormTx[];
  truncated: boolean;
  /** Labels discovered while fetching, keyed by normalized address. */
  labels: Record<string, AddressLabel[]>;
  sources: string[];
  notes: string[];
}

export interface CounterpartySnapshot {
  address: string;
  labels: AddressLabel[];
  /** Addresses this counterparty recently transacted with. */
  counterparties: string[];
}

/** One blockchain data provider, normalized to the engine's model. */
export interface DataSource {
  readonly chain: Chain;
  readonly name: string;
  /** Subrequests used by one getCounterpartySnapshot call. */
  readonly snapshotCost: number;
  getProfile(address: string): Promise<AddressProfile>;
  getHistory(address: string, opts: HistoryOptions): Promise<FetchedHistory>;
  getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot>;
}

export interface AdapterDeps {
  budget: SubrequestBudget;
  prices: PriceTable;
  apiKey?: string;
  /** Reports provider usage (Zerion: 1 per request). */
  onCompute?: (units: number) => void;
}

export class ChainUnavailableError extends Error {
  readonly code = 'CHAIN_UNAVAILABLE';
}

export function addLabels(map: Record<string, AddressLabel[]>, key: string, labels: AddressLabel[]): void {
  if (labels.length === 0) return;
  const existing = map[key] ?? [];
  for (const l of labels) if (!existing.some((e) => e.name === l.name && e.category === l.category)) existing.push(l);
  map[key] = existing;
}

/** The provider refuses to index this address (e.g. Zerion for exchange hot wallets). */
export class UntrackableAddressError extends Error {
  readonly code = 'UNTRACKABLE';
}
