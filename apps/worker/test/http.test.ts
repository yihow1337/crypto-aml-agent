import { describe, expect, it } from 'vitest';
import { BudgetExceededError, fetchJson, SubrequestBudget, UpstreamError } from '../src/lib/http';
import { json, mockFetch } from './helpers/fetch-mock';

describe('SubrequestBudget', () => {
  it('counts every outbound request and refuses beyond the limit', async () => {
    const m = mockFetch([['example.com', () => ({ ok: true })]]);
    const budget = new SubrequestBudget(2, m.fetch);
    await fetchJson(budget, 'https://example.com/a');
    await fetchJson(budget, 'https://example.com/b');
    expect(budget.used).toBe(2);
    await expect(fetchJson(budget, 'https://example.com/c')).rejects.toBeInstanceOf(BudgetExceededError);
    expect(m.calls).toHaveLength(2);
  });
});

describe('fetchJson', () => {
  it('retries once on 503 and then succeeds', async () => {
    let n = 0;
    const m = mockFetch([['x.test', () => (++n === 1 ? json({}, 503) : json({ v: 1 }))]]);
    const budget = new SubrequestBudget(10, m.fetch);
    await expect(fetchJson(budget, 'https://x.test/', undefined, { retryDelayMs: 1 })).resolves.toEqual({ v: 1 });
    expect(budget.used).toBe(2);
  });
  it('does not retry a 404 and reports the status', async () => {
    const m = mockFetch([['x.test', () => json({ message: 'Not found' }, 404)]]);
    const budget = new SubrequestBudget(10, m.fetch);
    const err = (await fetchJson(budget, 'https://x.test/').catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(404);
    expect(budget.used).toBe(1);
  });
  it('turns a hung request into an UpstreamError after the timeout', async () => {
    const hang = (async (_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const budget = new SubrequestBudget(10, hang);
    const err = (await fetchJson(budget, 'https://slow.test/', undefined, { timeoutMs: 20, retries: 0 }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(0);
  });
});
