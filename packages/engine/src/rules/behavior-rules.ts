import { fmtUsd } from '../format';
import { clamp01, DAY, dailyCounts, median, robustZScores } from '../stats';
import { isRoundAmount } from '../units';
import { RULE_CONFIG } from './config';
import { type RuleDef, txEvidence, usdOf } from './context';

export const R10: RuleDef = {
  id: 'R10',
  title: '交易速度突增',
  typology: '異常行為',
  description: '單日交易筆數相對於歷史基線的穩健 z 分數 > 3.5 且至少 10 筆。',
  severity: 'medium',
  weight: 25,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.velocity;
    if (ctx.txs.length < cfg.minCount) return null;
    const days = dailyCounts(
      ctx.txs.map((t) => t.ts),
      cfg.maxDays,
    );
    if (days.length < cfg.minDays) return null;
    const z = robustZScores(days.map((d) => d.count));
    let idx = 0;
    for (let i = 1; i < z.length; i++) if (z[i] > z[idx]) idx = i;
    if (z[idx] <= cfg.minZ || days[idx].count < cfg.minCount) return null;
    const date = days[idx].date;
    const dayTxs = ctx.txs.filter((t) => new Date(t.ts * 1000).toISOString().startsWith(date));
    return {
      intensity: clamp01(0.4 + (z[idx] - cfg.minZ) / 10),
      summary: `${date} 單日 ${days[idx].count} 筆交易，穩健 z 分數 ${z[idx].toFixed(1)}，遠高於平常水準。`,
      evidence: txEvidence(dayTxs, () => `${date} 交易突增`),
    };
  },
};

export const R11: RuleDef = {
  id: 'R11',
  title: '整數金額偏好',
  typology: '異常行為',
  description: '過半數交易為整數金額（如 10 ETH、5,000 USDT），常見於人工操作的洗錢或詐騙收付。',
  severity: 'low',
  weight: 15,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.round;
    const valued = ctx.txs.filter((t) => t.direction !== 'self' && t.amount > 0);
    if (valued.length < cfg.minN) return null;
    const round = valued.filter((t) => isRoundAmount(t.amount));
    const share = round.length / valued.length;
    if (share < cfg.minShare) return null;
    return {
      intensity: clamp01(0.4 + (share - 0.5) * 1.2),
      summary: `${round.length}/${valued.length} 筆（${(share * 100).toFixed(0)}%）為整數金額。`,
      evidence: txEvidence(round, (t) => `${t.amount} ${t.asset.symbol}`),
    };
  },
};

export const R12: RuleDef = {
  id: 'R12',
  title: '休眠後活化',
  typology: '異常行為',
  description: '地址沉寂 180 天以上後，於 7 天內移動 US$50,000 以上資金。',
  severity: 'medium',
  weight: 30,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.dormant;
    let best: { gap: number; usd: number; start: number } | null = null;
    for (let i = 1; i < ctx.txs.length; i++) {
      const gap = ctx.txs[i].ts - ctx.txs[i - 1].ts;
      if (gap < cfg.gapSec) continue;
      const start = ctx.txs[i].ts;
      let usd = 0;
      for (let j = i; j < ctx.txs.length && ctx.txs[j].ts - start <= cfg.windowSec; j++) usd += usdOf(ctx.txs[j]);
      if (usd >= cfg.minUsd && (!best || usd > best.usd)) best = { gap, usd, start };
    }
    if (!best) return null;
    const { gap, usd, start } = best;
    const window = ctx.txs.filter((t) => t.ts >= start && t.ts - start <= cfg.windowSec);
    return {
      intensity: clamp01(0.5 + usd / 1_000_000),
      summary: `沉寂 ${Math.round(gap / DAY)} 天後，7 天內移動約 ${fmtUsd(usd)}。`,
      evidence: txEvidence(window, () => '休眠後活化交易'),
    };
  },
};

export const R13: RuleDef = {
  id: 'R13',
  title: '新地址大額',
  typology: '異常行為',
  description: '建立不到 30 天的地址即轉入或轉出 US$100,000 以上（US$1,000,000 以上為高風險）資金。',
  severity: 'medium',
  weight: 25,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.newAddress;
    const firstSeen = ctx.profile.firstSeen ?? (ctx.truncated ? undefined : ctx.txs[0]?.ts);
    if (firstSeen === undefined || ctx.now - firstSeen > cfg.maxAgeSec) return null;
    let inUsd = 0;
    let outUsd = 0;
    for (const t of ctx.txs) {
      if (t.direction === 'in') inUsd += usdOf(t);
      else if (t.direction === 'out') outUsd += usdOf(t);
    }
    const usd = Math.max(inUsd, outUsd);
    if (usd < cfg.minUsd) return null;
    const high = usd >= cfg.highUsd;
    return {
      intensity: high ? 1 : 0.5 + (0.5 * (usd - cfg.minUsd)) / (cfg.highUsd - cfg.minUsd),
      severity: high ? 'high' : 'medium',
      summary: `地址首次活動距今僅 ${Math.max(1, Math.round((ctx.now - firstSeen) / DAY))} 天，已處理約 ${fmtUsd(usd)}。`,
      evidence: txEvidence(ctx.txs, () => '新地址大額交易', 3),
    };
  },
};

export const R18: RuleDef = {
  id: 'R18',
  title: '統計離群金額',
  typology: '統計異常',
  description: '以 log 金額的穩健 z 分數（MAD）偵測離群交易：z > 3.5、金額 ≥ US$10,000 且為中位數 5 倍以上。',
  severity: 'low',
  weight: 12,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.outlier;
    const valued = ctx.txs.filter((t) => usdOf(t) > 0);
    if (valued.length < cfg.minN) return null;
    const z = robustZScores(valued.map((t) => Math.log10(1 + usdOf(t))));
    const med = median(valued.map(usdOf));
    const outliers = valued.filter(
      (t, i) => z[i] > cfg.minZ && usdOf(t) >= cfg.minUsd && usdOf(t) >= cfg.minMedianMultiple * med,
    );
    if (outliers.length === 0) return null;
    return {
      intensity: clamp01(outliers.length / 3),
      summary: `${outliers.length} 筆交易金額顯著偏離此地址的常態分布。`,
      evidence: txEvidence(outliers, (t) => `離群金額 ${fmtUsd(t.usd)}`),
    };
  },
};
