import { shortAddress } from '../address';
import { CATEGORY_ZH } from '../labels';
import { fmtUsd } from '../format';
import { LEVEL_ZH } from '../scoring';
import type { AnalysisResult, RiskLevel } from '../types';

export const CHAIN_ZH = { eth: 'Ethereum', bsc: 'BNB Smart Chain', tron: 'TRON', btc: 'Bitcoin' } as const;

export const SEVERITY_ZH: Record<RiskLevel, string> = LEVEL_ZH;

function date(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function cell(s: string): string {
  return s.replace(/\|/g, '／').replace(/\n/g, ' ');
}

/** Code-generated score card; prepended to every report so the numbers can't be hallucinated. */
export function renderScoreCard(r: AnalysisResult): string {
  const lines = [
    '| 項目 | 數值 |',
    '|---|---|',
    `| 風險分數 | **${r.score} / 100** |`,
    `| 風險等級 | **${LEVEL_ZH[r.level]}** |`,
    `| 規則分數 S_rules | ${r.sRules.toFixed(1)} |`,
    `| 統計異常加成 | +${r.statsLift.toFixed(1)}（異常指數 ${r.stats.anomalyIndex.toFixed(2)}） |`,
  ];
  if (r.floorApplied) lines.push(`| 嚴重度下限 | ${cell(r.floorApplied)} |`);
  lines.push('', '| 規則 | 名稱 | 嚴重度 | 貢獻 |', '|---|---|---|---|');
  if (r.hits.length === 0) lines.push('| — | 未觸發任何偵測規則 | — | — |');
  for (const h of r.hits) {
    lines.push(
      `| ${h.id} | ${h.title} | ${LEVEL_ZH[h.severity]}${h.dampened ? '（減權）' : ''} | ${h.contribution.toFixed(1)} |`,
    );
  }
  return lines.join('\n');
}

function recommendations(level: RiskLevel): string[] {
  switch (level) {
    case 'critical':
      return [
        '立即暫停該地址相關之出金與入金，並評估凍結相關客戶資產。',
        '啟動加強盡職調查（EDD），確認實質受益人、資金來源及交易目的。',
        '依《洗錢防制法》向法務部調查局洗錢防制處提出疑似洗錢交易報告（STR）。',
        '保存全部交易與調查紀錄至少五年，並通報法遵主管。',
        '將地址及主要交易對手加入觀察名單持續監控。',
      ];
    case 'high':
      return [
        '啟動加強盡職調查（EDD），要求客戶說明資金來源與交易目的。',
        '評估暫停出金；若無法合理解釋，依法提出疑似洗錢交易報告（STR）。',
        '將地址及主要交易對手加入觀察名單持續監控。',
      ];
    case 'medium':
      return [
        '進行一般盡職調查，必要時請客戶補充說明交易背景。',
        '加入觀察名單，持續監控後續交易是否升級。',
      ];
    case 'low':
      return ['維持一般監控，無須額外措施。'];
  }
}

export interface TemplateReportOptions {
  title?: string;
  scenarioTitle?: string;
}

/** Deterministic zh-TW SAR-style report; used as the LLM fallback and as its factual baseline. */
export function renderTemplateReport(r: AnalysisResult, opts: TemplateReportOptions = {}): string {
  const s = r.subject;
  const p = r.profile;
  const out: string[] = [];
  out.push(`# ${opts.title ?? '虛擬資產反洗錢調查報告'}`);
  out.push('');
  out.push(
    `> 調查對象：\`${s.address}\`（${CHAIN_ZH[s.chain]}）${opts.scenarioTitle ? `　情境：${opts.scenarioTitle}` : ''}`,
  );
  out.push(`> 產生時間：${date(r.generatedAt)}　引擎版本：${r.engineVersion}`);
  out.push('');

  out.push('## 一、摘要');
  const labels = p.labels.map((l) => `${l.name}（${CATEGORY_ZH[l.category]}）`).join('、');
  out.push(
    `本地址共分析 ${r.stats.n} 筆交易（${date(r.stats.firstTs)} 至 ${date(r.stats.lastTs)}），轉入約 ${fmtUsd(
      r.stats.inUsd,
    )}、轉出約 ${fmtUsd(r.stats.outUsd)}，往來對手 ${r.stats.uniqueCounterparties} 個。${
      labels ? `地址標籤：${labels}。` : ''
    }`,
  );
  if (r.hits.length === 0) {
    out.push(`綜合評估風險等級為「${LEVEL_ZH[r.level]}」（${r.score} 分），未觸發任何偵測規則。`);
  } else {
    const top = r.hits.slice(0, 3).map((h) => h.title).join('、');
    out.push(
      `綜合評估風險等級為「${LEVEL_ZH[r.level]}」（${r.score} 分），主要風險因子為：${top}。以下發現均為「疑似」情形，需人工覆核確認。`,
    );
  }
  out.push('');

  out.push('## 二、風險等級與評分');
  out.push(renderScoreCard(r));
  out.push('');

  out.push('## 三、主要發現與證據');
  if (r.hits.length === 0) {
    out.push('未觸發任何偵測規則。');
  } else {
    out.push('| 規則 | 發現 | 證據 |', '|---|---|---|');
    for (const h of r.hits) {
      const ev = h.evidence
        .slice(0, 3)
        .map((e) => `${e.txHash ? `\`${shortAddress(e.txHash, 10, 6)}\`` : e.address ? `\`${shortAddress(e.address)}\`` : ''} ${e.note}`)
        .join('；');
      out.push(`| ${h.id} ${h.title} | ${cell(h.summary)} | ${cell(ev || '—')} |`);
    }
  }
  out.push('');

  out.push('## 四、資金流向分析');
  if (r.counterparties.length === 0) {
    out.push('無可分析之交易對手。');
  } else {
    out.push('| 交易對手 | 標籤 | 轉入 | 轉出 | 筆數 |', '|---|---|---|---|---|');
    for (const c of r.counterparties.slice(0, 8)) {
      const tag = c.sanctioned ? '制裁名單' : c.labels.map((l) => l.name).join('、') || '未標記';
      out.push(`| \`${shortAddress(c.address)}\` | ${cell(tag)} | ${fmtUsd(c.inUsd)} | ${fmtUsd(c.outUsd)} | ${c.txCount} |`);
    }
  }
  out.push('');

  out.push('## 五、建議措施');
  for (const rec of recommendations(r.level)) out.push(`- ${rec}`);
  out.push('');

  out.push('## 六、資料限制與免責聲明');
  for (const n of r.dataQuality.notes) out.push(`- ${n}`);
  if (r.dataQuality.sources.length) out.push(`- 資料來源：${r.dataQuality.sources.join('、')}。`);
  out.push('- 地址標籤與制裁名單可能不完整；未標記不代表無風險。');
  out.push('- 本報告由自動化系統依公開鏈上資料產生，僅供風險評估參考，不構成法律意見或對任何人之犯罪認定。');
  return out.join('\n');
}
