import { RULE_CONFIG } from './rules/config';
import type { RiskLevel, RuleHit, ScoreBreakdownItem } from './types';

export const LEVEL_ZH: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '極高',
};

export function levelFor(score: number): RiskLevel {
  const { medium, high, critical } = RULE_CONFIG.levels;
  if (score >= critical) return 'critical';
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  sRules: number;
  statsLift: number;
  floorApplied?: string;
  breakdown: ScoreBreakdownItem[];
}

/**
 * Deterministic risk score:
 *   S_rules = 100·[1 − Π(1 − w_i·c_i/100)]           (noisy-OR, saturating)
 *   S       = 100·[1 − (1 − S_rules/100)(1 − 0.1·A)]    (A = statistical anomaly index)
 * then severity floors. Mutates each hit's `contribution` and `dampened`.
 */
export function scoreHits(hits: RuleHit[], anomalyIndex: number, dampen: boolean): ScoreResult {
  const damp = RULE_CONFIG.dampener;
  let prod = 1;
  for (const h of hits) {
    h.dampened = dampen && (damp.rules as readonly string[]).includes(h.id);
    h.contribution = h.weight * h.intensity * (h.dampened ? damp.factor : 1);
    prod *= 1 - Math.min(100, h.contribution) / 100;
  }
  const sRules = 100 * (1 - prod);
  const a = Math.max(0, Math.min(1, anomalyIndex));
  const s = 100 * (1 - (1 - sRules / 100) * (1 - RULE_CONFIG.anomaly.maxLift * a));
  const statsLift = s - sRules;

  const f = RULE_CONFIG.floors;
  let floored = s;
  let floorApplied: string | undefined;
  const raise = (min: number, why: string) => {
    if (floored < min) {
      floored = min;
      floorApplied = why;
    }
  };
  if (hits.some((h) => h.id === 'R01')) raise(f.subjectSanctioned, 'R01 制裁名單主體 → 100');
  if (hits.some((h) => h.id === 'R02')) raise(f.directSanctions, 'R02 制裁直接往來 → 至少 80');
  if (hits.some((h) => h.severity === 'critical' && !h.dampened)) raise(f.critical, '極高嚴重度規則 → 至少 75');
  if (hits.some((h) => h.severity === 'high' && !h.dampened)) raise(f.high, '高嚴重度規則 → 至少 50');

  const score = Math.round(Math.min(100, floored));
  const total = hits.reduce((acc, h) => acc + h.contribution, 0);
  const breakdown = hits
    .map((h) => ({ id: h.id, title: h.title, points: total > 0 ? (h.contribution / total) * sRules : 0 }))
    .sort((x, y) => y.points - x.points);
  return { score, level: levelFor(score), sRules, statsLift, floorApplied, breakdown };
}
