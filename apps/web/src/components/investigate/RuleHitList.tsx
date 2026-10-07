'use client';

import { useState } from 'react';
import { fmtUsd, type Chain, type RuleHit } from '@aml/engine';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { AddressText, HashText } from '@/components/ui/Address';
import { SeverityChip, Tag } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/feedback';
import { fmtDateTime } from '@/lib/format';

const EVIDENCE_PREVIEW = 8;

/** Accordion of triggered rules with evidence rows (explorer links only for live data). */
export function RuleHitList({
  hits,
  chain,
  linkable,
  labelOf,
}: {
  hits: RuleHit[];
  chain: Chain;
  linkable: boolean;
  labelOf: (address: string) => string | undefined;
}) {
  if (hits.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="未觸發任何偵測規則"
        description="21 條規則（制裁、混幣、結構化、分層、地址投毒等）均未命中。這不代表地址無風險，標籤與資料可能不完整。"
      />
    );
  }
  const sorted = [...hits].sort((a, b) => b.contribution - a.contribution);
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {sorted.map((h, i) => (
        <li key={`${h.id}-${i}`}>
          <HitItem hit={h} chain={chain} linkable={linkable} labelOf={labelOf} defaultOpen={i === 0} />
        </li>
      ))}
    </ul>
  );
}

function HitItem({
  hit,
  chain,
  linkable,
  labelOf,
  defaultOpen,
}: {
  hit: RuleHit;
  chain: Chain;
  linkable: boolean;
  labelOf: (address: string) => string | undefined;
  defaultOpen: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const evidence = showAll ? hit.evidence : hit.evidence.slice(0, EVIDENCE_PREVIEW);
  return (
    <details className="group bg-surface open:bg-[#121d31]" open={defaultOpen}>
      <summary className="flex list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-raised/60 sm:px-4 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-2">{hit.id}</span>
        <span className="min-w-[9rem] flex-1 text-sm font-medium text-ink">{hit.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Tag>{hit.typology}</Tag>
          <SeverityChip level={hit.severity} size="xs" />
          {hit.dampened && (
            <Tag tone="warn" title="調查對象為交易所／服務商，行為類規則權重 ×0.3">
              減權 ×0.3
            </Tag>
          )}
          <span className="tabular w-16 text-right text-sm font-semibold text-ink" title={`權重 ${hit.weight} × 強度 ${hit.intensity.toFixed(2)}${hit.dampened ? ' × 0.3' : ''}`}>
            +{hit.contribution.toFixed(1)}
          </span>
        </span>
      </summary>
      <div className="space-y-3 px-3 pb-4 pl-10 sm:px-4 sm:pl-12">
        <p className="text-sm text-ink-2">{hit.summary}</p>
        <p className="text-xs text-ink-3">
          權重 w = {hit.weight}，強度 c = {hit.intensity.toFixed(2)}
          {hit.dampened ? '，減權 ×0.3' : ''}，貢獻 w·c = {hit.contribution.toFixed(1)}
        </p>
        {hit.evidence.length > 0 && (
          <div className="relative overflow-x-auto rounded-md border border-line scroll-thin">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-raised text-ink-3">
                <tr>
                  <th scope="col" className="px-2.5 py-1.5 font-medium">證據說明</th>
                  <th scope="col" className="px-2.5 py-1.5 font-medium">交易</th>
                  <th scope="col" className="px-2.5 py-1.5 font-medium">地址</th>
                  <th scope="col" className="px-2.5 py-1.5 font-medium">時間</th>
                  <th scope="col" className="px-2.5 py-1.5 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((e, j) => {
                  const label = e.address ? labelOf(e.address) : undefined;
                  return (
                    <tr key={j} className="border-t border-line align-top">
                      <td className="max-w-[280px] px-2.5 py-1.5 text-ink-2">{e.note}</td>
                      <td className="px-2.5 py-1.5">{e.txHash ? <HashText hash={e.txHash} chain={chain} linkable={linkable} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="px-2.5 py-1.5">
                        {e.address ? (
                          <span className="flex flex-col">
                            <AddressText address={e.address} chain={chain} linkable={linkable} />
                            {label && <span className="text-[11px] text-ink-3">{label}</span>}
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-ink-2">{e.ts ? fmtDateTime(e.ts) : '—'}</td>
                      <td className="tabular whitespace-nowrap px-2.5 py-1.5 text-right text-ink">{e.usd !== undefined ? fmtUsd(e.usd) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hit.evidence.length > EVIDENCE_PREVIEW && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-accent-ink underline underline-offset-2">
            {showAll ? '收合證據' : `顯示全部 ${hit.evidence.length} 筆證據`}
          </button>
        )}
      </div>
    </details>
  );
}
