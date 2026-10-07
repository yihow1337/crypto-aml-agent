import { type AddressProfile, curatedLabels, normalizeAddress, type ScenarioData } from '@aml/engine';
import type { CounterpartySnapshot, DataSource, FetchedHistory } from './types';

/** Serves a synthetic scenario through the same interface as the live chain adapters. */
export class ScenarioSource implements DataSource {
  readonly chain;
  readonly name = '內建合成情境';
  readonly snapshotCost = 0;
  private readonly subject: string;

  constructor(readonly data: ScenarioData) {
    this.chain = data.profile.chain;
    this.subject = normalizeAddress(this.chain, data.profile.address);
  }

  private isSubject(address: string): boolean {
    return normalizeAddress(this.chain, address) === this.subject;
  }

  private labelsFor(address: string) {
    const key = Object.keys(this.data.extraLabels ?? {}).find((k) => normalizeAddress(this.chain, k) === normalizeAddress(this.chain, address));
    return [...curatedLabels(this.chain, address), ...(key ? this.data.extraLabels![key] : [])];
  }

  async getProfile(address: string): Promise<AddressProfile> {
    if (this.isSubject(address)) return this.data.profile;
    return {
      chain: this.chain,
      address,
      nativeSymbol: this.data.profile.nativeSymbol,
      labels: this.labelsFor(address),
    };
  }

  async getHistory(address: string): Promise<FetchedHistory> {
    const labels = Object.fromEntries(
      Object.entries(this.data.extraLabels ?? {}).map(([k, v]) => [normalizeAddress(this.chain, k), v]),
    );
    if (this.isSubject(address)) {
      return { txs: this.data.txs, truncated: false, labels, sources: [this.name], notes: this.data.notes ?? [] };
    }
    return { txs: [], truncated: false, labels, sources: [this.name], notes: ['合成情境僅包含調查對象本身的交易資料。'] };
  }

  async getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    const exposure = Object.entries(this.data.exposure ?? {}).find(
      ([k]) => normalizeAddress(this.chain, k) === normalizeAddress(this.chain, address),
    )?.[1];
    return {
      address,
      labels: this.labelsFor(address),
      counterparties: exposure?.via ? [exposure.via] : [],
    };
  }
}
