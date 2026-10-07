import { isEvm, shortAddress } from '../address';
import { fmtUsd } from '../format';
import { isFakeStablecoin } from '../labels';
import { clamp01 } from '../stats';
import type { NormTx } from '../types';
import { RULE_CONFIG } from './config';
import { type RuleContext, type RuleDef, txEvidence, usdOf } from './context';

const POISON_CHAINS: RuleDef['chains'] = ['eth', 'bsc', 'tron'];

function isDustish(ctx: RuleContext, t: NormTx): boolean {
  if (t.amount === 0) return true;
  if (t.usd !== undefined && t.usd < RULE_CONFIG.poisoning.dustUsd) return true;
  return t.kind === 'token' && isFakeStablecoin(ctx.chain, t.asset.symbol, t.asset.contract);
}

/** What wallets display: first and last 4 characters of the address body. */
function lookalikeKey(ctx: RuleContext, address: string): string {
  const n = ctx.norm(address);
  const body = isEvm(ctx.chain) ? n.slice(2) : ctx.chain === 'tron' ? n.slice(1) : n;
  return `${body.slice(0, 4)}|${body.slice(-4)}`;
}

interface Poisoning {
  poisonTxs: NormTx[];
  /** poison address (normalized) → { first poison ts, mimicked address } */
  poisoners: Map<string, { ts: number; mimics: string }>;
}

const cache = new WeakMap<RuleContext, Poisoning>();

function findPoisoning(ctx: RuleContext): Poisoning {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const realByKey = new Map<string, { addr: string; norm: string; ts: number }[]>();
  for (const t of ctx.txs) {
    if (t.direction === 'self' || isDustish(ctx, t)) continue;
    const key = lookalikeKey(ctx, t.counterparty);
    const n = ctx.norm(t.counterparty);
    const list = realByKey.get(key) ?? [];
    if (!list.some((e) => e.norm === n)) list.push({ addr: t.counterparty, norm: n, ts: t.ts });
    realByKey.set(key, list);
  }
  const poisonTxs: NormTx[] = [];
  const poisoners = new Map<string, { ts: number; mimics: string }>();
  for (const t of ctx.txs) {
    if (t.direction === 'self' || !isDustish(ctx, t)) continue;
    const n = ctx.norm(t.counterparty);
    const real = (realByKey.get(lookalikeKey(ctx, t.counterparty)) ?? []).find((e) => e.norm !== n && e.ts <= t.ts);
    if (!real) continue;
    poisonTxs.push(t);
    if (!poisoners.has(n)) poisoners.set(n, { ts: t.ts, mimics: real.addr });
  }
  const result = { poisonTxs, poisoners };
  cache.set(ctx, result);
  return result;
}

export const R14A: RuleDef = {
  id: 'R14A',
  title: '地址投毒（受害目標）',
  typology: '詐騙',
  description: '收到與既有交易對手首尾字元相同之「相似地址」發出的零元、粉塵或假冒穩定幣轉帳。',
  severity: 'medium',
  weight: 20,
  chains: POISON_CHAINS,
  evaluate(ctx) {
    const { poisonTxs, poisoners } = findPoisoning(ctx);
    if (poisonTxs.length === 0) return null;
    return {
      intensity: clamp01(0.5 + 0.1 * poisoners.size),
      summary: `${poisoners.size} 個相似地址以零元/粉塵/假代幣交易投毒，企圖混入轉帳紀錄。`,
      evidence: txEvidence(poisonTxs, (t) => {
        const p = poisoners.get(ctx.norm(t.counterparty));
        return `仿冒 ${shortAddress(p?.mimics ?? '')}（${t.amount} ${t.asset.symbol}）`;
      }),
    };
  },
};

export const R14B: RuleDef = {
  id: 'R14B',
  title: '地址投毒受害轉帳',
  typology: '詐騙',
  description: '在投毒事件後，實際轉帳至仿冒的相似地址，資金極可能已遭竊取。',
  severity: 'high',
  weight: 55,
  chains: POISON_CHAINS,
  evaluate(ctx) {
    const { poisoners } = findPoisoning(ctx);
    if (poisoners.size === 0) return null;
    const paid = ctx.txs.filter((t) => {
      if (t.direction !== 'out' || isDustish(ctx, t)) return false;
      const p = poisoners.get(ctx.norm(t.counterparty));
      return p !== undefined && t.ts >= p.ts;
    });
    if (paid.length === 0) return null;
    const usd = paid.reduce((s, t) => s + usdOf(t), 0);
    return {
      intensity: usd >= 1000 ? 1 : 0.7,
      summary: `投毒後實際轉出 ${paid.length} 筆、約 ${fmtUsd(usd)} 至仿冒地址。`,
      evidence: txEvidence(paid, (t) => `誤轉至仿冒 ${shortAddress(poisoners.get(ctx.norm(t.counterparty))!.mimics)} 的地址`),
    };
  },
};

export const R14C: RuleDef = {
  id: 'R14C',
  title: '地址投毒攻擊者',
  typology: '詐騙',
  description: '地址活動以零元/粉塵/假代幣轉帳為主，且對象達 10 個以上，符合投毒攻擊者特徵。',
  severity: 'high',
  weight: 60,
  chains: POISON_CHAINS,
  evaluate(ctx) {
    const cfg = RULE_CONFIG.poisoning;
    const dust = ctx.txs.filter((t) => t.direction !== 'self' && isDustish(ctx, t));
    if (ctx.txs.length === 0 || dust.length / ctx.txs.length < cfg.attackerMinShare) return null;
    const targets = new Set(dust.map((t) => ctx.norm(t.counterparty)));
    if (targets.size < cfg.attackerMinReceivers) return null;
    return {
      intensity: clamp01(0.3 + targets.size / 30),
      summary: `${(100 * dust.length / ctx.txs.length).toFixed(0)}% 交易為零元/粉塵/假代幣，涉及 ${targets.size} 個對象。`,
      evidence: txEvidence(dust, (t) => `${t.amount} ${t.asset.symbol} 投毒轉帳`),
    };
  },
};
