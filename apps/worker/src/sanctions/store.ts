import { SANCTION_ASSETS, SANCTIONS_SNAPSHOT, SANCTIONS_SNAPSHOT_DATE, SanctionsIndex } from '@aml/engine';
import { type Env, nowSec } from '../env';
import { fetchText, type SubrequestBudget } from '../lib/http';
import { sha256Hex } from '../lib/store';

const SOURCE = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists';
const MEMO_TTL = 600;

let memo: { index: SanctionsIndex; loadedAt: number } | null = null;

export function resetSanctionsMemo(): void {
  memo = null;
}

/** OFAC index from D1 (refreshed daily by cron), falling back to the bundled snapshot per asset. */
export async function getSanctions(env: Env): Promise<SanctionsIndex> {
  if (memo && nowSec() - memo.loadedAt < MEMO_TTL) return memo.index;
  const rows = (
    await env.DB.prepare('SELECT asset, addresses_json, fetched_at FROM sanctions_lists').all<{
      asset: string;
      addresses_json: string;
      fetched_at: number;
    }>()
  ).results;
  const lists: Record<string, string[]> = { ...SANCTIONS_SNAPSHOT };
  let latest = 0;
  for (const r of rows) {
    lists[r.asset] = JSON.parse(r.addresses_json) as string[];
    latest = Math.max(latest, r.fetched_at);
  }
  const updatedAt = latest ? new Date(latest * 1000).toISOString().slice(0, 10) : SANCTIONS_SNAPSHOT_DATE;
  const index = SanctionsIndex.fromLists(lists, updatedAt);
  memo = { index, loadedAt: nowSec() };
  return index;
}

/** Download the nightly OFAC extractions; only rows whose content hash changed are rewritten. */
export async function refreshSanctions(env: Env, budget: SubrequestBudget): Promise<{ updated: string[]; failed: string[] }> {
  const existing = new Map(
    (await env.DB.prepare('SELECT asset, sha256 FROM sanctions_lists').all<{ asset: string; sha256: string }>()).results.map(
      (r) => [r.asset, r.sha256],
    ),
  );
  const updated: string[] = [];
  const failed: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  const results = await Promise.allSettled(
    SANCTION_ASSETS.map(async (asset) => {
      const url = `${SOURCE}/sanctioned_addresses_${asset}.txt`;
      const text = await fetchText(budget, url, undefined, { timeoutMs: 8000 });
      return { asset, url, text };
    }),
  );
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      failed.push(SANCTION_ASSETS[i]);
      continue;
    }
    const { asset, url, text } = r.value;
    const addresses = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
    if (addresses.length === 0) {
      failed.push(asset);
      continue;
    }
    const hash = await sha256Hex(addresses.join('\n'));
    if (existing.get(asset) === hash) continue;
    updated.push(asset);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO sanctions_lists (asset, sha256, addresses_json, count, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset) DO UPDATE SET sha256 = excluded.sha256, addresses_json = excluded.addresses_json,
           count = excluded.count, source_url = excluded.source_url, fetched_at = excluded.fetched_at`,
      ).bind(asset, hash, JSON.stringify(addresses), addresses.length, url, nowSec()),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  resetSanctionsMemo();
  return { updated, failed };
}
