import {
  type AddressLabel,
  type AddressProfile,
  type AnalysisResult,
  analyze,
  type Chain,
  type CounterpartyExposure,
  curatedLabels,
  hasCategory,
  isValidAddress,
  normalizeAddress,
  type SanctionsIndex,
  type ScenarioData,
} from '@aml/engine';
import { createSource, usesZerion } from '../adapters';
import { ScenarioSource } from '../adapters/scenario';
import { ChainUnavailableError, type DataSource, type FetchedHistory } from '../adapters/types';
import { type Env, intVar } from '../env';
import { ApiError } from '../lib/errors';
import type { SubrequestBudget } from '../lib/http';
import { getPrices } from '../lib/prices';
import { consumeQuota, peekQuota } from '../lib/store';
import { getSanctions } from '../sanctions/store';

export const HISTORY_LIMIT = 200;
export const ZERION_QUOTA_KEY = 'zerion-req';
/** Zerion's free plan allows 2,000 requests/day; keep some headroom. */
export const zerionDailyLimit = (env: Env) => intVar(env.ZERION_DAILY_REQUESTS, 1800);
/** Subrequests kept in reserve for the LLM when tracing. */
const TRACE_RESERVE = 8;

export interface TracedCounterparty {
  address: string;
  labels: AddressLabel[];
  checked: number;
  exposure: CounterpartyExposure;
}

export interface InvestigatorInit {
  env: Env;
  budget: SubrequestBudget;
  chain: Chain;
  address: string;
  scenario?: ScenarioData;
  historyLimit?: number;
}

/**
 * Fetches, memoizes and analyzes data about one subject address. Shared by /api/analyze,
 * /api/trace, the watchlist cron and the GLM agent tools, so every path yields the same score.
 */
export class Investigator {
  readonly env: Env;
  readonly budget: SubrequestBudget;
  readonly chain: Chain;
  readonly subject: string;
  readonly scenario?: ScenarioData;
  readonly mode: 'live' | 'scenario';
  private source?: DataSource;
  private readonly historyLimit: number;
  private readonly profiles = new Map<string, Promise<AddressProfile>>();
  private readonly histories = new Map<string, Promise<FetchedHistory>>();
  private sanctions?: SanctionsIndex;
  private computeUnits = 0;
  private seededLabels: Record<string, AddressLabel[]> = {};
  exposure: Record<string, CounterpartyExposure> = {};
  peelHops = 0;
  traced: TracedCounterparty[] | null = null;
  private result?: AnalysisResult;

  constructor(init: InvestigatorInit) {
    this.env = init.env;
    this.budget = init.budget;
    this.chain = init.chain;
    this.subject = init.address.trim();
    this.scenario = init.scenario;
    this.mode = init.scenario ? 'scenario' : 'live';
    this.historyLimit = init.historyLimit ?? HISTORY_LIMIT;
    if (init.scenario) {
      this.exposure = { ...(init.scenario.exposure ?? {}) };
      this.peelHops = init.scenario.peelHops ?? 0;
    } else if (!isValidAddress(this.chain, this.subject)) {
      throw new ApiError(400, 'INVALID_ADDRESS', `「${this.subject.slice(0, 80)}」不是有效的 ${this.chain.toUpperCase()} 地址。`);
    }
  }

  static forScenario(env: Env, budget: SubrequestBudget, scenario: ScenarioData): Investigator {
    return new Investigator({ env, budget, chain: scenario.profile.chain, address: scenario.profile.address, scenario });
  }

  norm(address: string): string {
    return normalizeAddress(this.chain, address);
  }

  isSubject(address: string): boolean {
    return this.norm(address) === this.norm(this.subject);
  }

  private async getSource(): Promise<DataSource> {
    if (this.source) return this.source;
    if (this.scenario) {
      this.source = new ScenarioSource(this.scenario);
      return this.source;
    }
    if (usesZerion(this.chain, this.env)) {
      const used = await peekQuota(this.env, ZERION_QUOTA_KEY);
      if (used >= zerionDailyLimit(this.env)) {
        throw new ChainUnavailableError('今日 ETH/BSC（Zerion）查詢額度已用完，請明天再試或改看內建情境。');
      }
    }
    const prices = await getPrices(this.env, this.budget);
    this.source = createSource(this.chain, {
      env: this.env,
      budget: this.budget,
      prices,
      onCompute: (u) => (this.computeUnits += u),
    });
    return this.source;
  }

  async getSanctions(): Promise<SanctionsIndex> {
    this.sanctions ??= await getSanctions(this.env);
    return this.sanctions;
  }

  profile(address = this.subject): Promise<AddressProfile> {
    const key = this.norm(address);
    let p = this.profiles.get(key);
    if (!p) {
      p = this.getSource().then((s) => s.getProfile(address));
      this.profiles.set(key, p);
      p.catch(() => this.profiles.delete(key));
    }
    return p;
  }

  history(address = this.subject): Promise<FetchedHistory> {
    const key = this.norm(address);
    let h = this.histories.get(key);
    if (!h) {
      h = this.getSource().then((s) => s.getHistory(address, { limit: this.historyLimit }));
      this.histories.set(key, h);
      h.catch(() => this.histories.delete(key));
    }
    return h;
  }

  /** Reuse a cached analysis instead of refetching the subject's data. */
  seed(cached: AnalysisResult): void {
    const key = this.norm(this.subject);
    this.profiles.set(key, Promise.resolve(cached.profile));
    for (const c of cached.counterparties) {
      const own = c.labels.filter((l) => l.source !== 'curated' && l.source !== 'ofac');
      if (own.length) this.seededLabels[this.norm(c.address)] = own;
    }
    this.histories.set(
      key,
      Promise.resolve({
        txs: cached.txs,
        truncated: cached.dataQuality.truncated,
        labels: this.seededLabels,
        sources: cached.dataQuality.sources,
        notes: cached.dataQuality.notes.filter((n) => !/少於 5 筆|僅分析最近|減權/.test(n)),
      }),
    );
    this.result = cached;
  }

  async analyze(): Promise<AnalysisResult> {
    if (this.result) return this.result;
    const [profile, history, sanctions] = await Promise.all([this.profile(), this.history(), this.getSanctions()]);
    this.result = analyze({
      profile,
      txs: history.txs,
      sanctions,
      extraLabels: { ...history.labels, ...(this.scenario?.extraLabels ?? {}) },
      exposure: this.exposure,
      peelHops: this.peelHops,
      now: this.scenario?.now,
      truncated: history.truncated,
      sources: history.sources,
      notes: history.notes,
    });
    return this.result;
  }

  /** 1-hop tracing of the top unlabeled counterparties for sanctions / mixer exposure (rule R03). */
  async trace(topN = 5): Promise<{ traced: TracedCounterparty[]; before: number; after: AnalysisResult }> {
    const base = await this.analyze();
    const source = await this.getSource();
    const sanctions = await this.getSanctions();
    const n = Math.min(topN, this.chain === 'bsc' ? 3 : 5);
    const candidates = base.counterparties
      .filter((c) => !c.sanctioned && !hasCategory(c.labels, 'exchange', 'stablecoin', 'mixer', 'bridge', 'defi', 'service'))
      .slice(0, n);
    const affordable = source.snapshotCost === 0
      ? candidates
      : candidates.slice(0, Math.max(0, Math.floor((this.budget.remaining() - TRACE_RESERVE) / source.snapshotCost)));
    const settled: PromiseSettledResult<Awaited<ReturnType<DataSource['getCounterpartySnapshot']>>>[] = [];
    for (let i = 0; i < affordable.length; i += 2) {
      settled.push(...(await Promise.allSettled(affordable.slice(i, i + 2).map((c) => source.getCounterpartySnapshot(c.address)))));
    }
    const traced: TracedCounterparty[] = [];
    settled.forEach((s, i) => {
      if (s.status !== 'fulfilled') return;
      const snap = s.value;
      const sanctionedVia = snap.counterparties.find((a) => !this.isSubject(a) && sanctions.has(this.chain, a));
      const mixerVia = snap.counterparties.find((a) => hasCategory(curatedLabels(this.chain, a), 'mixer'));
      const exposure: CounterpartyExposure = {
        sanctioned: Boolean(sanctionedVia),
        mixer: Boolean(mixerVia),
        via: sanctionedVia ?? mixerVia,
        note: this.scenario?.exposure?.[affordable[i].address]?.note,
      };
      traced.push({ address: affordable[i].address, labels: snap.labels, checked: snap.counterparties.length, exposure });
      if (exposure.sanctioned || exposure.mixer) this.exposure[affordable[i].address] = exposure;
    });
    this.traced = traced;
    this.result = undefined;
    const after = await this.analyze();
    return { traced, before: base.score, after };
  }

  /** Persist provider usage counters (Zerion requests). */
  async flushUsage(): Promise<void> {
    if (this.computeUnits > 0) {
      await consumeQuota(this.env, ZERION_QUOTA_KEY, zerionDailyLimit(this.env), this.computeUnits);
      this.computeUnits = 0;
    }
  }
}
