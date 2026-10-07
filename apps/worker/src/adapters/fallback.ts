import type { AddressProfile } from '@aml/engine';
import {
  type CounterpartySnapshot,
  type DataSource,
  type FetchedHistory,
  type HistoryOptions,
  UntrackableAddressError,
} from './types';

/** Uses `primary`, switching to `secondary` for addresses the primary provider refuses to track. */
export class FallbackSource implements DataSource {
  readonly chain;
  readonly snapshotCost;
  private secondaryInstance?: DataSource;
  private switched = false;

  constructor(
    private readonly primary: DataSource,
    private readonly makeSecondary: () => DataSource,
    private readonly note: string,
  ) {
    this.chain = primary.chain;
    this.snapshotCost = primary.snapshotCost;
  }

  get name(): string {
    return this.switched ? (this.secondaryInstance?.name ?? this.primary.name) : this.primary.name;
  }

  private secondary(): DataSource {
    this.secondaryInstance ??= this.makeSecondary();
    return this.secondaryInstance;
  }

  private async run<T>(fn: (s: DataSource) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (e) {
      if (!(e instanceof UntrackableAddressError)) throw e;
      this.switched = true;
      return fn(this.secondary());
    }
  }

  getProfile(address: string): Promise<AddressProfile> {
    return this.run((s) => s.getProfile(address));
  }

  async getHistory(address: string, opts: HistoryOptions): Promise<FetchedHistory> {
    let usedSecondary = false;
    const h = await this.run((s) => {
      usedSecondary = s !== this.primary;
      return s.getHistory(address, opts);
    });
    return usedSecondary ? { ...h, notes: [this.note, ...h.notes] } : h;
  }

  getCounterpartySnapshot(address: string): Promise<CounterpartySnapshot> {
    return this.run((s) => s.getCounterpartySnapshot(address));
  }
}
