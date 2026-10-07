import { hasCategory } from '../labels';
import { clamp01 } from '../stats';
import type { LabelCategory } from '../types';
import { activityShare, type RuleDef, totalUsdText, txEvidence } from './context';

function labeledCounterpartyRule(opts: {
  id: string;
  title: string;
  typology: string;
  description: string;
  weight: number;
  categories: LabelCategory[];
  multiplier: number;
  subjectSummary: string;
  noun: string;
}): RuleDef {
  return {
    id: opts.id,
    title: opts.title,
    typology: opts.typology,
    description: opts.description,
    severity: 'high',
    weight: opts.weight,
    evaluate(ctx) {
      if (hasCategory(ctx.subjectLabels, ...opts.categories)) {
        return {
          intensity: 1,
          summary: opts.subjectSummary,
          evidence: [{ address: ctx.subject, note: ctx.subjectLabels.map((l) => l.name).join('、') }],
        };
      }
      const txs = ctx.txs.filter(
        (t) => t.direction !== 'self' && hasCategory(ctx.labelsOf(t.counterparty), ...opts.categories),
      );
      if (txs.length === 0) return null;
      const share = activityShare(ctx, txs);
      const parties = new Set(txs.map((t) => ctx.norm(t.counterparty)));
      return {
        intensity: clamp01(Math.max(0.4, share * opts.multiplier)),
        summary: `與 ${parties.size} 個${opts.noun}往來 ${txs.length} 筆，約 ${totalUsdText(txs)}（占 ${(share * 100).toFixed(
          1,
        )}%）。`,
        evidence: txEvidence(txs, (t) => {
          const label = ctx.labelsOf(t.counterparty).find((l) => opts.categories.includes(l.category));
          return `${t.direction === 'out' ? '轉出至' : '收到自'} ${label?.name ?? opts.noun}`;
        }),
      };
    },
  };
}

export const R15 = labeledCounterpartyRule({
  id: 'R15',
  title: '詐騙/釣魚交易對手',
  typology: '詐騙',
  description: '交易對手被標記為詐騙、釣魚、駭客或漏洞利用者（Blockscout 標籤、is_scam 或內建名單）。',
  weight: 50,
  categories: ['scam'],
  multiplier: 10,
  subjectSummary: '調查地址本身被標記為詐騙/釣魚/駭客相關地址。',
  noun: '詐騙/釣魚標記地址',
});

export const R17 = labeledCounterpartyRule({
  id: 'R17',
  title: '高風險服務',
  typology: '高風險服務',
  description: '交易對手為高風險服務（如受 FinCEN 311 處分之擔保平台、無 KYC 交易所、線上博弈）。',
  weight: 40,
  categories: ['high_risk', 'gambling'],
  multiplier: 5,
  subjectSummary: '調查地址本身屬於高風險服務或博弈平台。',
  noun: '高風險服務',
});
