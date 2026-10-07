import { robustZScores } from './stats';
import type { NormTx } from './types';
import { isRoundAmount } from './units';

export const FEATURE_NAMES = [
  'log_usd',
  'direction',
  'hour_sin',
  'hour_cos',
  'log_gap_prev',
  'log_hold',
  'cp_frequency',
  'first_interaction',
  'label_risk',
  'amount_z',
  'round_amount',
  'degree_24h',
] as const;

export const FEATURE_ZH: Record<(typeof FEATURE_NAMES)[number], string> = {
  log_usd: '金額規模',
  direction: '資金方向',
  hour_sin: '交易時段',
  hour_cos: '交易時段',
  log_gap_prev: '與前筆交易間隔',
  log_hold: '轉入至轉出的持有時間',
  cp_frequency: '交易對手往來頻率',
  first_interaction: '首次往來的對手',
  label_risk: '對手標籤風險',
  amount_z: '金額偏離程度',
  round_amount: '整數金額',
  degree_24h: '24 小時內對手數',
};

const DAY = 86400;

/**
 * One 12-dimensional feature vector per transaction (input sorted by time ascending).
 * Used by the browser-side Isolation Forest.
 */
export function txFeatures(txs: NormTx[], labelRiskOf: (address: string) => number): number[][] {
  const key = (a: string) => a.toLowerCase();
  const cpCount = new Map<string, number>();
  for (const t of txs) cpCount.set(key(t.counterparty), (cpCount.get(key(t.counterparty)) ?? 0) + 1);
  const logUsd = txs.map((t) => Math.log10(1 + (t.usd ?? t.amount)));
  const z = robustZScores(logUsd);
  const seen = new Set<string>();
  let lastIn: number | undefined;
  let windowStart = 0;
  const windowCounts = new Map<string, number>();

  return txs.map((t, i) => {
    const hour = ((t.ts % DAY) / 3600) * ((2 * Math.PI) / 24);
    const gap = i > 0 ? t.ts - txs[i - 1].ts : 0;
    const hold = t.direction === 'out' && lastIn !== undefined ? t.ts - lastIn : 0;
    if (t.direction === 'in') lastIn = t.ts;
    const k = key(t.counterparty);
    const first = seen.has(k) ? 0 : 1;
    seen.add(k);

    windowCounts.set(k, (windowCounts.get(k) ?? 0) + 1);
    while (t.ts - txs[windowStart].ts > DAY) {
      const ks = key(txs[windowStart].counterparty);
      const c = (windowCounts.get(ks) ?? 1) - 1;
      if (c === 0) windowCounts.delete(ks);
      else windowCounts.set(ks, c);
      windowStart++;
    }

    return [
      logUsd[i],
      t.direction === 'in' ? 0 : t.direction === 'out' ? 1 : 0.5,
      Math.sin(hour),
      Math.cos(hour),
      Math.log10(1 + gap),
      Math.log10(1 + hold),
      (cpCount.get(k) ?? 1) / txs.length,
      first,
      labelRiskOf(t.counterparty),
      Math.max(-10, Math.min(10, z[i])),
      isRoundAmount(t.amount) ? 1 : 0,
      Math.log10(1 + windowCounts.size),
    ];
  });
}
