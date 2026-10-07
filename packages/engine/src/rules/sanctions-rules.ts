import { shortAddress } from '../address';
import { fmtUsd } from '../format';
import { hasCategory } from '../labels';
import { clamp01 } from '../stats';
import type { Evidence } from '../types';
import { RULE_CONFIG } from './config';
import { activityShare, type RuleDef, totalUsdText, txEvidence } from './context';

export const R01: RuleDef = {
  id: 'R01',
  title: '制裁名單主體',
  typology: '制裁',
  description: '調查地址本身列於 OFAC SDN 制裁名單，任何往來皆可能違反制裁規定。',
  severity: 'critical',
  weight: 100,
  evaluate(ctx) {
    if (!ctx.isSanctioned(ctx.subject)) return null;
    return {
      intensity: 1,
      summary: '調查地址本身列於美國財政部 OFAC SDN 制裁名單。',
      evidence: [{ address: ctx.subject, note: 'OFAC SDN 數位貨幣地址' }],
    };
  },
};

export const R02: RuleDef = {
  id: 'R02',
  title: '制裁直接往來',
  typology: '制裁',
  description: '與 OFAC 制裁地址有直接轉入或轉出紀錄；轉出至制裁地址視為最嚴重情形。',
  severity: 'critical',
  weight: 90,
  evaluate(ctx) {
    const hits = ctx.txs.filter((t) => t.direction !== 'self' && ctx.isSanctioned(t.counterparty));
    if (hits.length === 0) return null;
    const out = hits.filter((t) => t.direction === 'out');
    const parties = new Set(hits.map((t) => ctx.norm(t.counterparty)));
    return {
      intensity: out.length > 0 ? 1 : 0.9,
      summary: `與 ${parties.size} 個 OFAC 制裁地址直接往來：轉出 ${out.length} 筆、轉入 ${
        hits.length - out.length
      } 筆，合計約 ${totalUsdText(hits)}。`,
      evidence: txEvidence(hits, (t) => (t.direction === 'out' ? '轉出至制裁地址' : '收到制裁地址資金')),
    };
  },
};

export const R03: RuleDef = {
  id: 'R03',
  title: '制裁間接暴露（1-hop）',
  typology: '制裁',
  description: '主要交易對手（依金額前 N 名）曾與制裁地址或混幣器直接往來，形成間接暴露。',
  severity: 'high',
  weight: 45,
  evaluate(ctx) {
    if (ctx.exposure.size === 0) return null;
    const exposed = [...ctx.exposure.entries()].filter(
      ([cp, e]) =>
        (e.sanctioned || e.mixer) &&
        !ctx.isSanctioned(cp) &&
        !hasCategory(ctx.labelsOf(cp), 'mixer'),
    );
    if (exposed.length === 0) return null;
    const keys = new Set(exposed.map(([cp]) => cp));
    const txs = ctx.txs.filter((t) => keys.has(ctx.norm(t.counterparty)));
    const share = activityShare(ctx, txs);
    const evidence: Evidence[] = exposed.slice(0, 5).map(([cp, e]) => ({
      address: txs.find((t) => ctx.norm(t.counterparty) === cp)?.counterparty ?? cp,
      note: `交易對手曾與${e.sanctioned ? '制裁地址' : '混幣器'}${e.via ? ` ${shortAddress(e.via)}` : ''} 往來${
        e.note ? `（${e.note}）` : ''
      }`,
    }));
    return {
      intensity: clamp01(Math.max(RULE_CONFIG.indirect.minIntensity, share * RULE_CONFIG.indirect.shareMultiplier)),
      summary: `${exposed.length} 個主要交易對手具制裁或混幣器暴露，相關交易約占總量 ${(share * 100).toFixed(
        1,
      )}%（${fmtUsd(txs.reduce((s, t) => s + (t.usd ?? 0), 0))}）。`,
      evidence,
    };
  },
};
