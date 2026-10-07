import type { Env } from '../env';
import { nowSec } from '../env';
import { fetchJson, type SubrequestBudget } from './http';

export interface PriceTable {
  ETH: number;
  BNB: number;
  TRX: number;
  BTC: number;
  source: 'live' | 'cache' | 'fallback';
}

/** Used only when both CoinGecko and the D1 cache are unavailable (snapshot 2026-10-07). */
export const FALLBACK_PRICES: Omit<PriceTable, 'source'> = { ETH: 2560, BNB: 766, TRX: 0.334, BTC: 83000 };

const IDS: Record<keyof Omit<PriceTable, 'source'>, string> = {
  ETH: 'ethereum',
  BNB: 'binancecoin',
  TRX: 'tron',
  BTC: 'bitcoin',
};
const TTL = 3600;

export async function getPrices(env: Env, budget: SubrequestBudget): Promise<PriceTable> {
  const rows = (await env.DB.prepare('SELECT symbol, usd, fetched_at FROM prices').all<{ symbol: string; usd: number; fetched_at: number }>()).results;
  const cached = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const symbols = Object.keys(IDS) as (keyof typeof IDS)[];
  const fresh = symbols.every((s) => cached[s] && cached[s].fetched_at > nowSec() - TTL);
  if (fresh) return { ...Object.fromEntries(symbols.map((s) => [s, cached[s].usd])), source: 'cache' } as PriceTable;
  try {
    const data = await fetchJson<Record<string, { usd: number }>>(
      budget,
      `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(IDS).join(',')}&vs_currencies=usd`,
      undefined,
      { timeoutMs: 4000, retries: 0 },
    );
    const table = { source: 'live' } as PriceTable;
    const ts = nowSec();
    const stmts: D1PreparedStatement[] = [];
    for (const s of symbols) {
      const usd = data[IDS[s]]?.usd;
      table[s] = typeof usd === 'number' && usd > 0 ? usd : (cached[s]?.usd ?? FALLBACK_PRICES[s]);
      stmts.push(
        env.DB.prepare(
          'INSERT INTO prices (symbol, usd, fetched_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET usd = excluded.usd, fetched_at = excluded.fetched_at',
        ).bind(s, table[s], ts),
      );
    }
    await env.DB.batch(stmts);
    return table;
  } catch {
    const table = { source: rows.length ? 'cache' : 'fallback' } as PriceTable;
    for (const s of symbols) table[s] = cached[s]?.usd ?? FALLBACK_PRICES[s];
    return table;
  }
}
