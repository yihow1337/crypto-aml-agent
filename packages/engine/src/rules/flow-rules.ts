import { fmtDuration, fmtUsd } from '../format';
import { clamp01 } from '../stats';
import type { NormTx } from '../types';
import { RULE_CONFIG } from './config';
import { maxDistinctInWindow, type RuleDef, type RuleOutcome, txEvidence, usdOf } from './context';

export const R06: RuleDef = {
  id: 'R06',
  title: '結構化/拆分交易',
  typology: '結構化 (Structuring)',
  description:
    '7 天內多筆金額落在申報門檻 85%–100% 之間（US$10,000、US$3,000、約 NT$500,000），或 24 小時內大量小額來源匯集超過門檻（Smurfing）。',
  severity: 'medium',
  weight: 40,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.structuring;
    let best: { count: number; threshold: number; txs: NormTx[] } = { count: 0, threshold: 0, txs: [] };
    for (const threshold of cfg.thresholdsUsd) {
      const cands = ctx.txs.filter(
        (t) => t.direction !== 'self' && t.usd !== undefined && t.usd >= cfg.band * threshold && t.usd < threshold,
      );
      let start = 0;
      for (let end = 0; end < cands.length; end++) {
        while (cands[end].ts - cands[start].ts > cfg.windowSec) start++;
        const count = end - start + 1;
        if (count > best.count) best = { count, threshold, txs: cands.slice(start, end + 1) };
      }
    }

    const smallIn = ctx.txs.filter((t) => t.direction === 'in' && usdOf(t) > 0 && usdOf(t) < cfg.smurf.smallUsd);
    let smurf = { senders: 0, total: 0, txs: [] as NormTx[] };
    {
      const counts = new Map<string, number>();
      let total = 0;
      let start = 0;
      for (let end = 0; end < smallIn.length; end++) {
        const k = ctx.norm(smallIn[end].counterparty);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        total += usdOf(smallIn[end]);
        while (smallIn[end].ts - smallIn[start].ts > cfg.smurf.windowSec) {
          const ks = ctx.norm(smallIn[start].counterparty);
          const c = (counts.get(ks) ?? 1) - 1;
          if (c === 0) counts.delete(ks);
          else counts.set(ks, c);
          total -= usdOf(smallIn[start]);
          start++;
        }
        if (total >= cfg.smurf.minTotalUsd && counts.size > smurf.senders) {
          smurf = { senders: counts.size, total, txs: smallIn.slice(start, end + 1) };
        }
      }
    }

    const structuring = best.count >= cfg.minCount ? Math.min(1, 0.55 + 0.15 * (best.count - cfg.minCount)) : 0;
    const smurfing = smurf.senders >= cfg.smurf.minSenders ? Math.min(1, 0.5 + smurf.senders / 40) : 0;
    if (structuring === 0 && smurfing === 0) return null;
    const intensity = Math.max(structuring, smurfing);
    const parts: string[] = [];
    if (structuring > 0) {
      parts.push(`7 天內 ${best.count} 筆金額落在 ${fmtUsd(best.threshold)} 門檻下方 15% 區間`);
    }
    if (smurfing > 0) {
      parts.push(`24 小時內 ${smurf.senders} 個不同來源以小額匯入合計 ${fmtUsd(smurf.total)}`);
    }
    return {
      intensity,
      severity: intensity >= 0.85 ? 'high' : 'medium',
      summary: `${parts.join('；')}，疑似刻意規避申報門檻。`,
      evidence: txEvidence(structuring >= smurfing ? best.txs : smurf.txs, (t) =>
        structuring >= smurfing ? `接近門檻金額 ${fmtUsd(t.usd)}` : `小額匯入 ${fmtUsd(t.usd)}`,
      ),
    };
  },
};

export const R07: RuleDef = {
  id: 'R07',
  title: '快速過帳/分層',
  typology: '分層 (Layering)',
  description:
    '資金轉入後短時間（EVM/TRON 1 小時、BTC 6 小時）內 80% 以上即轉出，且整體留存率極低，屬典型過水帳戶行為。',
  severity: 'high',
  weight: 45,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.passThrough;
    const window = ctx.chain === 'btc' ? cfg.windowSecBtc : cfg.windowSec;
    const events: { inflow: NormTx; outflow: NormTx; delay: number }[] = [];
    for (let i = 0; i < ctx.txs.length; i++) {
      const inflow = ctx.txs[i];
      if (inflow.direction !== 'in') continue;
      const priced = inflow.usd !== undefined;
      if (priced ? inflow.usd! < cfg.minInflowUsd : !(inflow.amount > 0)) continue;
      const target = cfg.minShare * (priced ? inflow.usd! : inflow.amount);
      let acc = 0;
      for (let j = i + 1; j < ctx.txs.length && ctx.txs[j].ts - inflow.ts <= window; j++) {
        const o = ctx.txs[j];
        if (o.direction !== 'out') continue;
        acc += priced ? usdOf(o) : o.asset.symbol === inflow.asset.symbol ? o.amount : 0;
        if (acc >= target) {
          events.push({ inflow, outflow: o, delay: o.ts - inflow.ts });
          break;
        }
      }
    }
    if (events.length < cfg.minEvents) return null;
    let inUsd = 0;
    let outUsd = 0;
    for (const t of ctx.txs) {
      if (t.direction === 'in') inUsd += usdOf(t);
      else if (t.direction === 'out') outUsd += usdOf(t);
    }
    const ratio = inUsd > 0 ? outUsd / inUsd : 0;
    const ratioOk = ratio >= 0.9 && ratio <= 1.1;
    const avgDelay = events.reduce((s, e) => s + e.delay, 0) / events.length;
    return {
      intensity: Math.min(1, 0.4 + 0.12 * events.length) * (ratioOk ? 1 : 0.75),
      summary: `${events.length} 次資金轉入後平均 ${fmtDuration(avgDelay)}內即轉出 80% 以上${
        ratioOk ? `，整體轉出/轉入比 ${(ratio * 100).toFixed(0)}%，留存極低` : ''
      }，呈過水分層特徵。`,
      evidence: events.slice(0, 5).map((e) => ({
        txHash: e.outflow.hash,
        address: e.outflow.counterparty,
        ts: e.outflow.ts,
        usd: e.outflow.usd,
        note: `轉入 ${fmtUsd(e.inflow.usd)} 後 ${fmtDuration(e.delay)} 轉出`,
      })),
    };
  },
};

export const R08: RuleDef = {
  id: 'R08',
  title: '剝離鏈 (Peel Chain)',
  typology: '分層 (Layering)',
  description:
    '比特幣交易反覆以「小額支付 + 大額找零」方式逐步剝離資金（小額/大額輸出比 < 0.2），常見於駭客與勒索款洗錢。',
  severity: 'medium',
  weight: 35,
  chains: ['btc'],
  evaluate(ctx) {
    const cfg = RULE_CONFIG.peel;
    const subject = ctx.norm(ctx.subject);
    const peels = ctx.txs.filter((t) => {
      const b = t.btc;
      if (!b || t.direction !== 'out' || b.nOut !== 2) return false;
      const changeIdx = b.outputAddrs.findIndex((a) => ctx.norm(a) === subject);
      if (changeIdx < 0) return false;
      const change = b.outValues[changeIdx];
      const paid = b.outValues[1 - changeIdx];
      return change > 0 && paid / change < cfg.maxRatio;
    });
    const n = Math.max(peels.length, ctx.peelHops);
    if (n < cfg.minCount) return null;
    return {
      intensity: Math.min(1, 0.6 + 0.1 * (n - cfg.minCount)),
      summary:
        ctx.peelHops >= cfg.minCount
          ? `追蹤大額找零輸出，連續 ${ctx.peelHops} 跳均呈剝離鏈結構。`
          : `${peels.length} 筆交易以小額支付、大額找零回原地址方式逐步剝離資金。`,
      evidence: txEvidence(peels, () => '小額輸出 + 大額找零'),
    };
  },
};

function fanRule(direction: 'in' | 'out'): RuleDef {
  const isIn = direction === 'in';
  return {
    id: isIn ? 'R09A' : 'R09B',
    title: isIn ? '資金匯集 (Fan-in)' : '資金分散 (Fan-out)',
    typology: isIn ? '匯集' : '分散',
    description: isIn
      ? '24 小時內自 20 個以上（或 7 天內 50 個以上）不同地址收款，常見於詐騙收款或車手帳戶。'
      : '24 小時內轉出至 20 個以上（或 7 天內 50 個以上）不同地址，常見於分散洗錢或空投洗量。',
    severity: 'medium',
    weight: 30,
    evaluate(ctx): RuleOutcome | null {
      const cfg = RULE_CONFIG.fan;
      const txs = ctx.txs.filter((t) => t.direction === direction);
      const key = (t: NormTx) => ctx.norm(t.counterparty);
      const d24 = maxDistinctInWindow(txs, 86400, key);
      const d7 = maxDistinctInWindow(txs, 7 * 86400, key);
      if (d24.distinct < cfg.minDistinct24h && d7.distinct < cfg.minDistinct7d) return null;
      const win = d24.distinct >= cfg.minDistinct24h ? d24 : d7;
      return {
        intensity: clamp01(Math.max(0.5, d24.distinct / 40, d7.distinct / 100)),
        summary: `${isIn ? '自' : '轉出至'} ${d24.distinct} 個不同地址（24 小時內）/ ${d7.distinct} 個（7 天內）。`,
        evidence: txEvidence(txs.slice(win.from, win.to + 1), () => (isIn ? '匯集來源' : '分散去向')),
      };
    },
  };
}

export const R09A = fanRule('in');
export const R09B = fanRule('out');
