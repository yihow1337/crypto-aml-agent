import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | unknown;

export interface MockFetch {
  fetch: typeof fetch;
  calls: { url: string; init?: RequestInit }[];
}

/** Route-based fake fetch: the first route whose matcher matches the URL answers. */
export function mockFetch(routes: [string | RegExp, Handler][]): MockFetch {
  const calls: MockFetch['calls'] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    for (const [m, h] of routes) {
      if (typeof m === 'string' ? url.includes(m) : m.test(url)) {
        const r = await h(url, init);
        return r instanceof Response ? r : json(r);
      }
    }
    return new Response(JSON.stringify({ message: 'no mock route' }), { status: 404 });
  };
  return { fetch: fn as typeof fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')) as T;
}
