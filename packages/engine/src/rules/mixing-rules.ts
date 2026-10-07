import { fmtDuration } from '../format';
import { hasCategory } from '../labels';
import { clamp01 } from '../stats';
import type { NormTx } from '../types';
import { RULE_CONFIG } from './config';
import { type RuleDef, totalUsdText, txEvidence } from './context';

export const R04: RuleDef = {
  id: 'R04',
  title: '混幣器互動',
  typology: '混幣/匿名化',
  description: '與 Tornado Cash 等混幣器合約往來。存入（轉出至混幣器）權重高於提領。',
  severity: 'high',
  weight: 60,
  evaluate(ctx) {
    if (hasCategory(ctx.subjectLabels, 'mixer')) {
      return {
        intensity: 1,
        summary: '調查地址本身為混幣器合約。',
        evidence: [{ address: ctx.subject, note: '混幣器合約' }],
      };
    }
    const mix = ctx.txs.filter((t) => t.direction !== 'self' && hasCategory(ctx.labelsOf(t.counterparty), 'mixer'));
    if (mix.length === 0) return null;
    const deposits = mix.filter((t) => t.direction === 'out');
    const base = deposits.length > 0 ? 1 : 0.9;
    return {
      intensity: base * Math.min(1, (mix.length + 1) / 4),
      summary: `與混幣器往來 ${mix.length} 筆（存入 ${deposits.length}、提領 ${
        mix.length - deposits.length
      }），合計約 ${totalUsdText(mix)}。`,
      evidence: txEvidence(mix, (t) => {
        const name = ctx.labelsOf(t.counterparty).find((l) => l.category === 'mixer')?.name ?? '混幣器';
        return t.direction === 'out' ? `存入 ${name}` : `自 ${name} 提領`;
      }),
    };
  },
};

export const R05: RuleDef = {
  id: 'R05',
  title: 'CoinJoin 混幣交易',
  typology: '混幣/匿名化',
  description: '比特幣交易具多輸入、多輸出且大量輸出金額相同（Whirlpool/Wasabi 等 CoinJoin 特徵）。',
  severity: 'medium',
  weight: 40,
  chains: ['btc'],
  evaluate(ctx) {
    const cfg = RULE_CONFIG.coinjoin;
    const found: { tx: NormTx; c: number; equal: number; value: number }[] = [];
    for (const t of ctx.txs) {
      const b = t.btc;
      if (!b || b.nIn < cfg.minIn || b.nOut < cfg.minOut) continue;
      const groups = new Map<string, number>();
      for (const v of b.outValues) {
        if (v < cfg.minValueBtc) continue;
        const k = v.toFixed(8);
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      let equal = 0;
      let value = 0;
      for (const [k, n] of groups) if (n > equal) [equal, value] = [n, Number(k)];
      if (equal < cfg.minEqual) continue;
      const pool = cfg.whirlpoolBtc.some((d) => Math.abs(d - value) < 1e-9) ? 0.2 : 0;
      found.push({ tx: t, c: clamp01(equal / b.nOut + pool), equal, value });
    }
    if (found.length === 0) return null;
    const maxC = Math.max(...found.map((f) => f.c));
    const intensity = clamp01(maxC * (found.length >= 2 ? 1 : 0.85));
    return {
      intensity,
      severity: found.length >= 3 || intensity >= 0.8 ? 'high' : 'medium',
      summary: `${found.length} 筆交易呈現 CoinJoin 特徵（最多 ${Math.max(
        ...found.map((f) => f.equal),
      )} 個等額輸出）。`,
      evidence: found.slice(0, 5).map((f) => ({
        txHash: f.tx.hash,
        ts: f.tx.ts,
        usd: f.tx.usd,
        note: `${f.tx.btc!.nIn} 輸入 / ${f.tx.btc!.nOut} 輸出，其中 ${f.equal} 個皆為 ${f.value} BTC`,
      })),
    };
  },
};

export const R16: RuleDef = {
  id: 'R16',
  title: '跨鏈橋跳轉',
  typology: '分層/跨鏈',
  description: '資金自跨鏈橋轉入後短時間內再轉往跨鏈橋，常見於跨鏈分層以切斷追蹤。',
  severity: 'medium',
  weight: 30,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.bridge;
    const isBridge = (t: NormTx) => hasCategory(ctx.labelsOf(t.counterparty), 'bridge');
    const hops: { inflow: NormTx; outflow: NormTx }[] = [];
    for (let i = 0; i < ctx.txs.length; i++) {
      const inflow = ctx.txs[i];
      if (inflow.direction !== 'in' || !isBridge(inflow)) continue;
      for (let j = i + 1; j < ctx.txs.length && ctx.txs[j].ts - inflow.ts <= cfg.windowSec; j++) {
        const o = ctx.txs[j];
        if (o.direction === 'out' && isBridge(o)) {
          hops.push({ inflow, outflow: o });
          break;
        }
      }
    }
    const mixer = ctx.txs.some((t) => hasCategory(ctx.labelsOf(t.counterparty), 'mixer'));
    if (hops.length < cfg.minHops && !(hops.length >= 1 && mixer)) return null;
    return {
      intensity: clamp01(Math.max(0.5, hops.length / 3)),
      summary: `偵測到 ${hops.length} 次「跨鏈橋轉入 → ${fmtDuration(cfg.windowSec)}內轉出至跨鏈橋」${
        mixer ? '，並伴隨混幣器互動' : ''
      }。`,
      evidence: hops.slice(0, 5).map((h) => ({
        txHash: h.outflow.hash,
        address: h.outflow.counterparty,
        ts: h.outflow.ts,
        usd: h.outflow.usd,
        note: `轉入後 ${fmtDuration(h.outflow.ts - h.inflow.ts)} 轉出至跨鏈橋`,
      })),
    };
  },
};
