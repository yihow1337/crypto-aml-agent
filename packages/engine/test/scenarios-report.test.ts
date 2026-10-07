import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { renderScoreCard, renderTemplateReport } from '../src/report/template';
import { SanctionsIndex } from '../src/sanctions';
import { buildScenario, SCENARIOS } from '../src/scenarios';
import { run, tx, addr, TORNADO_ROUTER } from './helpers';

const sanctions = SanctionsIndex.fromSnapshot();

function analyzeScenario(id: string) {
  const s = buildScenario(id)!;
  return analyze({ ...s, sanctions });
}

describe('scenario catalogue', () => {
  it('has ten scenarios covering all four chains', () => {
    expect(SCENARIOS).toHaveLength(10);
    expect(new Set(SCENARIOS.map((s) => s.chain))).toEqual(new Set(['eth', 'bsc', 'tron', 'btc']));
  });
  it('returns undefined for unknown ids', () => {
    expect(buildScenario('nope')).toBeUndefined();
  });
  it('is deterministic', () => {
    expect(buildScenario('s3')).toEqual(buildScenario('s3'));
  });
});

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('scenario %s', (id, meta) => {
  const r = analyzeScenario(id);
  it(`lands in the expected level (${meta.expected.levels.join('/')})`, () => {
    expect(meta.expected.levels).toContain(r.level);
  });
  it(`fires the expected rules (${meta.expected.rules.join(', ') || 'none'})`, () => {
    const fired = r.hits.map((h) => h.id);
    for (const rule of meta.expected.rules) expect(fired).toContain(rule);
  });
  it('has enough transactions for the UI', () => {
    expect(r.txs.length).toBeGreaterThanOrEqual(5);
  });
});

describe('template report', () => {
  it('includes the score card, every triggered rule and level-specific actions', () => {
    const r = analyzeScenario('s1');
    const md = renderTemplateReport(r);
    expect(md).toContain('一、摘要');
    expect(md).toContain(`${r.score} / 100`);
    expect(md).toContain('極高');
    for (const h of r.hits) expect(md).toContain(h.title);
    expect(md).toContain('疑似洗錢交易報告');
    expect(md).toContain('六、資料限制與免責聲明');
  });
  it('states that no rule fired for a clean address', () => {
    const r = run([tx({ direction: 'in', counterparty: addr(1), usd: 123.45, amount: 0.04937 })]);
    const md = renderTemplateReport(r);
    expect(md).toContain('未觸發任何偵測規則');
    expect(md).not.toContain('疑似洗錢交易報告');
  });
  it('renders a compact score card table', () => {
    const r = run([tx({ direction: 'out', counterparty: TORNADO_ROUTER })]);
    const card = renderScoreCard(r);
    expect(card).toContain('| 風險分數 |');
    expect(card).toContain('R04');
  });
});
