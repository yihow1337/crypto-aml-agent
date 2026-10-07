import { isValidAddress, LEVEL_ZH, type NormTx } from '@aml/engine';
import { z } from 'zod';
import type { Investigator } from '../services/investigator';
import type { ToolDefinition } from './glm';

export const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_address_profile',
      description:
        '取得地址基本資料：餘額、交易筆數、首次/最近活動時間、是否為合約、標籤與 OFAC 制裁狀態。省略 address 時查詢調查對象。',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string', description: '要查詢的地址（同一條鏈）；省略則為調查對象' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: '取得調查對象的交易統計：期間、轉入/轉出金額、前 10 大交易對手（含標籤與制裁狀態）與金額最大的 10 筆交易。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_aml_analysis',
      description:
        '執行確定性 AML 規則引擎（制裁、混幣、結構化、分層、剝離鏈、投毒等 18 類洗錢態樣規則與統計異常），回傳官方風險分數、等級與各規則證據。報告中的分數與等級必須以此為準。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screen_sanctions',
      description: '以 OFAC SDN 制裁名單與內建標籤篩查最多 20 個地址。',
      parameters: {
        type: 'object',
        properties: { addresses: { type: 'array', items: { type: 'string' }, maxItems: 20 } },
        required: ['addresses'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trace_counterparties',
      description:
        '對前 N 大未標記交易對手做一層（1-hop）追蹤，檢查其近期是否與制裁地址或混幣器往來，並以此重新計算風險分數（規則 R03）。',
      parameters: {
        type: 'object',
        properties: { top_n: { type: 'integer', minimum: 1, maximum: 5, description: '追蹤的交易對手數量，預設 5' } },
      },
    },
  },
];

export const TOOL_ZH: Record<string, string> = {
  get_address_profile: '取得地址概況',
  get_transactions: '取得交易紀錄',
  run_aml_analysis: '執行 AML 規則分析',
  screen_sanctions: '制裁名單篩查',
  trace_counterparties: '追蹤交易對手',
};

export interface ToolOutcome {
  ok: boolean;
  summary: string;
  /** Compact JSON passed back to the LLM. */
  content: string;
}

const MAX_CONTENT = 4000;
const PROFILE_RESERVE = 12;

const iso = (ts?: number) => (ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : null);
const r2 = (n?: number) => (n === undefined ? null : Math.round(n * 100) / 100);

function pack(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length <= MAX_CONTENT ? s : `${s.slice(0, MAX_CONTENT - 20)}…(truncated)`;
}

function fail(message: string): ToolOutcome {
  return { ok: false, summary: message, content: pack({ error: message }) };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw || '{}');
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function txBrief(t: NormTx) {
  return {
    hash: t.hash,
    time: iso(t.ts),
    direction: t.direction,
    counterparty: t.counterparty,
    amount: Number(t.amount.toPrecision(8)),
    symbol: t.asset.symbol,
    usd: r2(t.usd),
  };
}

export async function executeTool(inv: Investigator, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const args = parseArgs(rawArgs);
  try {
    switch (name) {
      case 'get_address_profile': {
        const requested = typeof args.address === 'string' ? args.address.trim() : '';
        const address = requested && !inv.isSubject(requested) ? requested : inv.subject;
        if (!isValidAddress(inv.chain, address) && inv.mode === 'live') return fail(`無效的地址：${requested.slice(0, 60)}`);
        if (!inv.isSubject(address) && inv.budget.remaining() < PROFILE_RESERVE) return fail('外部查詢額度不足，略過此地址。');
        const [p, sanctions] = await Promise.all([inv.profile(address), inv.getSanctions()]);
        const sanctioned = sanctions.has(inv.chain, address);
        return {
          ok: true,
          summary: `${p.balance !== undefined ? `餘額 ${Number(p.balance.toPrecision(6))} ${p.nativeSymbol}` : '餘額未知'}${
            p.txCount !== undefined ? `，${p.txCount} 筆交易` : ''
          }${p.labels.length ? `，標籤：${p.labels.map((l) => l.name).join('、')}` : ''}${sanctioned ? '，⚠ OFAC 制裁名單' : ''}`,
          content: pack({
            chain: p.chain,
            address,
            isSubject: inv.isSubject(address),
            balance: p.balance,
            nativeSymbol: p.nativeSymbol,
            balanceUsd: r2(p.balanceUsd),
            txCount: p.txCount ?? null,
            firstSeen: iso(p.firstSeen),
            lastSeen: iso(p.lastSeen),
            isContract: p.isContract ?? null,
            labels: p.labels.map((l) => ({ name: l.name, category: l.category })),
            ofacSanctioned: sanctioned,
          }),
        };
      }
      case 'get_transactions': {
        const r = await inv.analyze();
        const okTxs = r.txs.filter((t) => t.status === 'ok');
        const largest = [...okTxs].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 10).map(txBrief);
        return {
          ok: true,
          summary: `${r.stats.n} 筆交易，轉入 US$${Math.round(r.stats.inUsd).toLocaleString()}／轉出 US$${Math.round(
            r.stats.outUsd,
          ).toLocaleString()}，${r.stats.uniqueCounterparties} 個交易對手`,
          content: pack({
            n: r.stats.n,
            period: { from: iso(r.stats.firstTs), to: iso(r.stats.lastTs) },
            inUsd: r2(r.stats.inUsd),
            outUsd: r2(r.stats.outUsd),
            uniqueCounterparties: r.stats.uniqueCounterparties,
            truncatedHistory: r.dataQuality.truncated,
            topCounterparties: r.counterparties.slice(0, 10).map((c) => ({
              address: c.address,
              labels: c.labels.map((l) => l.name),
              ofacSanctioned: c.sanctioned,
              inUsd: r2(c.inUsd),
              outUsd: r2(c.outUsd),
              txCount: c.txCount,
            })),
            largestTransactions: largest,
          }),
        };
      }
      case 'run_aml_analysis': {
        const r = await inv.analyze();
        return {
          ok: true,
          summary: `風險分數 ${r.score}（${LEVEL_ZH[r.level]}），觸發 ${r.hits.length} 條規則`,
          content: pack({
            score: r.score,
            level: r.level,
            levelZh: LEVEL_ZH[r.level],
            ruleScore: r2(r.sRules),
            statisticalLift: r2(r.statsLift),
            floorApplied: r.floorApplied ?? null,
            counterpartiesTraced: inv.traced !== null,
            hits: r.hits.map((h) => ({
              id: h.id,
              title: h.title,
              severity: h.severity,
              contribution: r2(h.contribution),
              dampened: h.dampened,
              summary: h.summary,
              evidence: h.evidence.slice(0, 3).map((e) => ({ txHash: e.txHash ?? null, address: e.address ?? null, note: e.note })),
            })),
            dataNotes: r.dataQuality.notes,
          }),
        };
      }
      case 'screen_sanctions': {
        const parsed = z.array(z.string()).max(20).safeParse(args.addresses);
        if (!parsed.success) return fail('addresses 必須是最多 20 個地址字串的陣列');
        const sanctions = await inv.getSanctions();
        const r = await inv.analyze();
        const byAddr = new Map(r.counterparties.map((c) => [inv.norm(c.address), c]));
        const results = parsed.data.map((a) => ({
          address: a,
          ofacSanctioned: sanctions.has(inv.chain, a),
          labels: (byAddr.get(inv.norm(a))?.labels ?? []).map((l) => l.name),
        }));
        const hits = results.filter((x) => x.ofacSanctioned).length;
        return {
          ok: true,
          summary: `篩查 ${results.length} 個地址，${hits} 個列於 OFAC 制裁名單`,
          content: pack({ listUpdatedAt: sanctions.updatedAt, results }),
        };
      }
      case 'trace_counterparties': {
        const n = Math.max(1, Math.min(5, Number(args.top_n ?? 5) || 5));
        const { traced, before, after } = await inv.trace(n);
        const exposed = traced.filter((t) => t.exposure.sanctioned || t.exposure.mixer);
        return {
          ok: true,
          summary: `追蹤 ${traced.length} 個交易對手，${exposed.length} 個具制裁/混幣器暴露；風險分數 ${before} → ${after.score}`,
          content: pack({
            traced: traced.map((t) => ({
              address: t.address,
              labels: t.labels.map((l) => l.name),
              recentCounterpartiesChecked: t.checked,
              sanctionedExposure: t.exposure.sanctioned,
              mixerExposure: t.exposure.mixer,
              via: t.exposure.via ?? null,
            })),
            scoreBefore: before,
            scoreAfter: after.score,
            levelAfter: LEVEL_ZH[after.level],
            r03: after.hits.find((h) => h.id === 'R03')?.summary ?? null,
          }),
        };
      }
      default:
        return fail(`未知的工具：${name}`);
    }
  } catch (e) {
    return fail(`工具執行失敗：${(e as Error).message}`.slice(0, 200));
  }
}
