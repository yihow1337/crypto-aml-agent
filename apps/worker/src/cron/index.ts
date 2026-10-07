import {
  type Chain,
  type RiskLevel,
  rawToDecimal,
  shortAddress,
  tronHexToBase58,
} from '@aml/engine';
import { type Env, nowSec } from '../env';
import { fetchJson, type SubrequestBudget } from '../lib/http';
import { getPrices } from '../lib/prices';
import { cachePut, getCursor, setCursorStmt } from '../lib/store';
import { getSanctions, refreshSanctions } from '../sanctions/store';
import { Investigator } from '../services/investigator';

export const CRONS = { sweep: '*/10 * * * *', watchlist: '*/15 * * * *', daily: '17 3 * * *' } as const;

const TORNADO_ROUTER = '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b';
const ROUTER_DEPOSIT = '0x13d98d13';
const TRONGRID = 'https://api.trongrid.io';
const ALERT_RETENTION = 14 * 86400;
/**
 * Etherscan-compatible Blockscout endpoint. Anonymous use allows ~10 req/min per (shared) IP;
 * with BLOCKSCOUT_API_KEY the PRO API is rate-limited per key. The cron tolerates failures.
 */
export function blockscoutCompactUrl(env: Env, query: string): string {
  if (!env.BLOCKSCOUT_API_KEY) return `https://eth.blockscout.com/api?${query}`;
  return `https://api.blockscout.com/v2/api?chain_id=1&${query}&apikey=${encodeURIComponent(env.BLOCKSCOUT_API_KEY)}`;
}
const FIRST_LOOKBACK = 30 * 86400;

interface CompactTx {
  hash: string;
  timeStamp: string;
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  input?: string;
}


/** Minimal ETH transaction used by the sweep. */
interface SweepTx {
  hash: string;
  ts: number;
  block: number;
  from: string;
  to: string;
  value: string;
  ok: boolean;
  input?: string;
}

/** Latest ETH transactions of an address via Blockscout's Etherscan-compatible API. */
async function latestEthTxs(env: Env, budget: SubrequestBudget, address: string, limit: number): Promise<SweepTx[]> {
  const r = await fetchJson<{ result: CompactTx[] | string }>(
    budget,
    blockscoutCompactUrl(env, `module=account&action=txlist&address=${address}&page=1&offset=${limit}&sort=desc`),
  );
  return (Array.isArray(r.result) ? r.result : []).map((t) => ({
    hash: t.hash,
    ts: Number(t.timeStamp),
    block: Number(t.blockNumber),
    from: t.from.toLowerCase(),
    to: (t.to ?? '').toLowerCase(),
    value: t.value,
    ok: t.isError !== '1',
    input: t.input,
  }));
}

interface AlertInput {
  chain: Chain;
  address: string;
  source: 'sweep' | 'watchlist';
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  txHash: string;
  counterparty?: string;
  usd?: number;
  ts?: number;
}

function alertStmt(env: Env, a: AlertInput): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO alerts (chain, address, source, rule_id, severity, title, detail, tx_hash, counterparty, usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  ).bind(a.chain, a.address, a.source, a.ruleId, a.severity, a.title, a.detail, a.txHash, a.counterparty ?? null, a.usd ?? null, a.ts ?? nowSec());
}

/** Decode `_recipient` (5th head word) from a Tornado router withdraw() call. */
export function tornadoRecipient(input: string | undefined): string | null {
  if (!input || input.length < 10 + 64 * 5) return null;
  const word = input.slice(10 + 64 * 4, 10 + 64 * 5);
  return /^0{24}[0-9a-f]{40}$/i.test(word) ? `0x${word.slice(24).toLowerCase()}` : null;
}

/** Every 10 min: Tornado router activity + rotating checks of OFAC-listed ETH/TRON addresses. */
export async function ethSweep(env: Env, budget: SubrequestBudget): Promise<Record<string, number>> {
  const stmts: D1PreparedStatement[] = [];
  const stats = { tornado: 0, ofacEth: 0, ofacTron: 0, errors: 0 };
  const prices = await getPrices(env, budget);

  // 1. Tornado Cash router deposits / withdrawals since the last block seen.
  try {
    const cursor = Number((await getCursor(env, 'sweep:tornado-block')) ?? 0);
    const txs = (await latestEthTxs(env, budget, TORNADO_ROUTER, 20)).filter((t) => t.block > cursor);
    let maxBlock = cursor;
    for (const t of txs) {
      maxBlock = Math.max(maxBlock, t.block);
      if (!t.ok) continue;
      const eth = rawToDecimal(t.value, 18);
      const usd = eth * prices.ETH;
      if (t.input?.slice(0, 10) === ROUTER_DEPOSIT) {
        stmts.push(
          alertStmt(env, {
            chain: 'eth', address: t.from, source: 'sweep', ruleId: 'R04', severity: 'high',
            title: '混幣器存入（Tornado Cash）',
            detail: `地址 ${shortAddress(t.from)} 透過 Tornado Cash Router 存入${eth > 0 ? ` ${eth} ETH` : ' ERC-20 代幣'}。`,
            txHash: t.hash, counterparty: TORNADO_ROUTER, usd: usd || undefined, ts: t.ts,
          }),
        );
        stats.tornado++;
      } else {
        const recipient = tornadoRecipient(t.input);
        if (!recipient) continue;
        stmts.push(
          alertStmt(env, {
            chain: 'eth', address: recipient, source: 'sweep', ruleId: 'R04', severity: 'medium',
            title: '混幣器提領（Tornado Cash）',
            detail: `Tornado Cash 提領至 ${shortAddress(recipient)}（由 relayer ${shortAddress(t.from)} 送出）。`,
            txHash: t.hash, counterparty: TORNADO_ROUTER, ts: t.ts,
          }),
        );
        stats.tornado++;
      }
    }
    if (maxBlock > cursor) stmts.push(setCursorStmt(env, 'sweep:tornado-block', String(maxBlock)));
  } catch {
    stats.errors++;
  }

  const sanctions = await getSanctions(env);

  // 2. Rotate through OFAC ETH addresses (3 per run).
  const perRun = 3;
  const ethList = sanctions.addresses('eth').sort();
  const ethIdx = Number((await getCursor(env, 'sweep:ofac-eth-idx')) ?? 0) % Math.max(1, ethList.length);
  for (const addr of ethList.slice(ethIdx, ethIdx + perRun)) {
    try {
      const since = Number((await getCursor(env, `sweep:ofac:${addr}`)) ?? nowSec() - FIRST_LOOKBACK);
      let latest = since;
      for (const t of await latestEthTxs(env, budget, addr, 5)) {
        const ts = t.ts;
        latest = Math.max(latest, ts);
        if (ts <= since || !t.ok) continue;
        const outgoing = t.from === addr;
        const other = outgoing ? t.to : t.from;
        const eth = rawToDecimal(t.value, 18);
        stmts.push(
          alertStmt(env, {
            chain: 'eth', address: addr, source: 'sweep', ruleId: 'R01', severity: 'critical',
            title: 'OFAC 制裁地址資金異動',
            detail: `制裁地址${outgoing ? '轉出至' : '收到來自'} ${shortAddress(other)}${eth > 0 ? ` ${eth.toPrecision(4)} ETH` : '（合約呼叫）'}。`,
            txHash: t.hash, counterparty: other, usd: eth * prices.ETH || undefined, ts,
          }),
        );
        stats.ofacEth++;
      }
      stmts.push(setCursorStmt(env, `sweep:ofac:${addr}`, String(latest)));
    } catch {
      stats.errors++;
    }
  }
  stmts.push(setCursorStmt(env, 'sweep:ofac-eth-idx', String((ethIdx + perRun) % Math.max(1, ethList.length))));

  // 3. Rotate through OFAC TRON addresses via TRC-20 transfers (2 per run).
  const tronList = sanctions.addresses('tron').sort();
  const tronIdx = Number((await getCursor(env, 'sweep:ofac-tron-idx')) ?? 0) % Math.max(1, tronList.length);
  const headers: Record<string, string> = env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': env.TRONGRID_API_KEY } : {};
  for (const addr of tronList.slice(tronIdx, tronIdx + 2)) {
    try {
      const since = Number((await getCursor(env, `sweep:ofac:${addr}`)) ?? nowSec() - FIRST_LOOKBACK);
      const r = await fetchJson<{ data?: { transaction_id: string; block_timestamp: number; from: string; to: string; value: string; token_info?: { symbol?: string; decimals?: number } }[] }>(
        budget,
        `${TRONGRID}/v1/accounts/${addr}/transactions/trc20?limit=5&only_confirmed=true`,
        { headers },
      );
      let latest = since;
      for (const t of r.data ?? []) {
        const ts = Math.floor(t.block_timestamp / 1000);
        latest = Math.max(latest, ts);
        if (ts <= since) continue;
        const outgoing = t.from === addr;
        const other = outgoing ? t.to : t.from;
        const amount = rawToDecimal(t.value, t.token_info?.decimals ?? 6);
        const symbol = t.token_info?.symbol ?? 'TRC20';
        stmts.push(
          alertStmt(env, {
            chain: 'tron', address: addr, source: 'sweep', ruleId: 'R01', severity: 'critical',
            title: 'OFAC 制裁地址資金異動',
            detail: `制裁地址${outgoing ? '轉出至' : '收到來自'} ${shortAddress(tronHexToBase58(other))} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}。`,
            txHash: t.transaction_id, counterparty: other, usd: /^USD/.test(symbol) ? amount : undefined, ts,
          }),
        );
        stats.ofacTron++;
      }
      stmts.push(setCursorStmt(env, `sweep:ofac:${addr}`, String(latest)));
    } catch {
      stats.errors++;
    }
  }
  stmts.push(setCursorStmt(env, 'sweep:ofac-tron-idx', String((tronIdx + 2) % Math.max(1, tronList.length))));
  stmts.push(setCursorStmt(env, 'sweep:last', String(nowSec())));
  await env.DB.batch(stmts);
  return stats;
}

/**
 * Every 15 min: re-analyze the two least-recently scanned watchlist addresses. Zerion-backed
 * chains (ETH/BSC with a key) are rescanned at most every 6 h to stay within the daily request budget.
 */
export async function watchlistScan(env: Env, budget: SubrequestBudget): Promise<Record<string, number>> {
  const now = nowSec();
  const rows = (
    await env.DB.prepare(
      `SELECT id, chain, address FROM watchlist
       WHERE NOT (chain = 'bsc' AND ?1 = 0)
         AND NOT (chain IN ('eth', 'bsc') AND ?1 = 1 AND COALESCE(last_scanned_at, 0) > ?2)
       ORDER BY COALESCE(last_scanned_at, 0) ASC LIMIT 2`,
    )
      .bind(env.ZERION_API_KEY ? 1 : 0, now - 6 * 3600)
      .all<{ id: number; chain: Chain; address: string }>()
  ).results;
  const stats = { scanned: 0, alerts: 0, errors: 0 };
  for (const w of rows) {
    const stmts: D1PreparedStatement[] = [];
    try {
      const inv = new Investigator({ env, budget, chain: w.chain, address: w.address, historyLimit: 50 });
      const r = await inv.analyze();
      await inv.flushUsage();
      for (const h of r.hits.filter((x) => x.severity !== 'low')) {
        const ev = h.evidence[0];
        stmts.push(
          alertStmt(env, {
            chain: w.chain, address: w.address, source: 'watchlist', ruleId: h.id, severity: h.severity,
            title: h.title, detail: h.summary, txHash: ev?.txHash ?? `watch:${w.id}`, counterparty: ev?.address, usd: ev?.usd,
          }),
        );
        stats.alerts++;
      }
      stmts.push(
        env.DB.prepare('UPDATE watchlist SET last_scanned_at = ?, last_score = ?, last_level = ? WHERE id = ?').bind(
          now,
          r.score,
          r.level as RiskLevel,
          w.id,
        ),
      );
      await env.DB.batch(stmts);
      await cachePut(env, `analysis:${w.chain}:${inv.norm(w.address)}`, r, 600);
      stats.scanned++;
    } catch {
      stats.errors++;
      await env.DB.prepare('UPDATE watchlist SET last_scanned_at = ? WHERE id = ?').bind(now, w.id).run();
    }
  }
  return stats;
}

/** Daily: refresh OFAC lists and prune old data. */
export async function dailyMaintenance(env: Env, budget: SubrequestBudget): Promise<Record<string, unknown>> {
  const sanctions = await refreshSanctions(env, budget);
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM alerts WHERE created_at < ?').bind(now - ALERT_RETENTION),
    env.DB.prepare('DELETE FROM analysis_cache WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM quotas WHERE window_start < ?').bind(now - 2 * 86400),
  ]);
  return { sanctionsUpdated: sanctions.updated, sanctionsFailed: sanctions.failed };
}

export type JobName = 'sweep' | 'watchlist' | 'sanctions';

export function runJob(job: JobName, env: Env, budget: SubrequestBudget): Promise<Record<string, unknown>> {
  switch (job) {
    case 'sweep':
      return ethSweep(env, budget);
    case 'watchlist':
      return watchlistScan(env, budget);
    case 'sanctions':
      return dailyMaintenance(env, budget);
  }
}

export function jobForCron(cron: string): JobName | null {
  if (cron === CRONS.sweep) return 'sweep';
  if (cron === CRONS.watchlist) return 'watchlist';
  if (cron === CRONS.daily) return 'sanctions';
  return null;
}
