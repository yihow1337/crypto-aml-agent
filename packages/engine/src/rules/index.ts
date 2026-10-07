import { R10, R11, R12, R13, R18 } from './behavior-rules';
import { R15, R17 } from './counterparty-rules';
import { R06, R07, R08, R09A, R09B } from './flow-rules';
import { R04, R05, R16 } from './mixing-rules';
import { R14A, R14B, R14C } from './poisoning-rules';
import { R01, R02, R03 } from './sanctions-rules';
import type { RuleDef } from './context';

/** Rule registry in display order. */
export const RULES: RuleDef[] = [
  R01, R02, R03, R04, R05, R06, R07, R08, R09A, R09B,
  R10, R11, R12, R13, R14A, R14B, R14C, R15, R16, R17, R18,
];

export interface RuleInfo {
  id: string;
  title: string;
  typology: string;
  description: string;
  severity: RuleDef['severity'];
  weight: number;
  chains: string[];
}

export function ruleCatalog(): RuleInfo[] {
  return RULES.map((r) => ({
    id: r.id,
    title: r.title,
    typology: r.typology,
    description: r.description,
    severity: r.severity,
    weight: r.weight,
    chains: r.chains ?? ['eth', 'bsc', 'tron', 'btc'],
  }));
}

export { RULE_CONFIG } from './config';
export type { RuleContext, RuleDef, RuleOutcome } from './context';
