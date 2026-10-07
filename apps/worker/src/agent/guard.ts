import { type AnalysisResult, LEVEL_ZH, renderScoreCard } from '@aml/engine';

/** Addresses and hashes for all four chains, longest alternatives first. */
const REF_RE =
  /0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40}|\bT[1-9A-HJ-NP-Za-km-z]{33}\b|\bbc1[02-9ac-hj-np-z]{11,71}\b|\b[0-9a-fA-F]{64}\b|\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g;

function normRef(ref: string): string {
  return /^(0x|bc1)/i.test(ref) || /^[0-9a-fA-F]{64}$/.test(ref) ? ref.toLowerCase() : ref;
}

export function collectRefs(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(REF_RE)) out.add(normRef(m[0]));
  return out;
}

export function knownRefs(result: AnalysisResult, toolText: string): Set<string> {
  const known = collectRefs(toolText);
  known.add(normRef(result.subject.address));
  for (const t of result.txs) {
    known.add(normRef(t.hash));
    known.add(normRef(t.counterparty));
  }
  for (const c of result.counterparties) known.add(normRef(c.address));
  for (const h of result.hits) {
    for (const e of h.evidence) {
      if (e.txHash) known.add(normRef(e.txHash));
      if (e.address) known.add(normRef(e.address));
    }
  }
  return known;
}

export interface GuardResult {
  markdown: string;
  scoreFixed: boolean;
  unverifiedRefs: number;
}

const UNVERIFIED = '〔未驗證〕';

/**
 * Anti-hallucination guard for LLM reports: fixes any risk score / level that disagrees with
 * the rule engine, flags addresses and hashes that never appeared in tool output, and inserts
 * the code-generated score card.
 */
export function applyGuard(llmMarkdown: string, result: AnalysisResult, known: Set<string>): GuardResult {
  let scoreFixed = false;
  let text = llmMarkdown.trim();

  text = text.replace(
    /(風險分數|風險評分|綜合評分|總分)([^0-9\n]{0,12}?)(\d{1,3}(?:\.\d+)?)/g,
    (all, label: string, sep: string, num: string) => {
      if (Number(num) === result.score || /由|從|原|前/.test(sep)) return all;
      scoreFixed = true;
      return `${label}${sep}${result.score}`;
    },
  );
  const levelZh = LEVEL_ZH[result.level];
  text = text.replace(/(風險等級)([^\n]{0,8}?)(極高|高|中|低)/g, (all, label: string, sep: string, lv: string) => {
    if (lv === levelZh) return all;
    scoreFixed = true;
    return `${label}${sep}${levelZh}`;
  });

  let unverifiedRefs = 0;
  text = text.replace(REF_RE, (m: string, offset: number, whole: string) => {
    if (known.has(normRef(m))) return m;
    if (whole.slice(offset + m.length, offset + m.length + UNVERIFIED.length + 1).includes(UNVERIFIED)) return m;
    unverifiedRefs++;
    return `${m} ${UNVERIFIED}`;
  });

  const card = [
    '> **系統計算之風險評分卡**：以下數值由確定性規則引擎產生，不受 LLM 影響；報告內文的分數以此為準。',
    '',
    renderScoreCard(result),
  ].join('\n');
  const lines = text.split('\n');
  const titleIdx = lines.findIndex((l) => /^#\s/.test(l));
  const markdown =
    titleIdx === 0
      ? [lines[0], '', card, '', ...lines.slice(1)].join('\n')
      : ['# 虛擬資產反洗錢調查報告', '', card, '', text].join('\n');
  return { markdown, scoreFixed, unverifiedRefs };
}
