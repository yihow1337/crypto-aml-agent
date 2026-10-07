'use client';

import Link from 'next/link';
import { type Chain, type CounterpartySummary } from '@aml/engine';
import { ScanSearch } from 'lucide-react';
import { AddressText } from '@/components/ui/Address';
import { LabelChip, riskTier, Tag, TierDot } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/feedback';
import { fmtDate, fmtInt, fmtUsdCompact } from '@/lib/format';

export function CounterpartyTable({
  counterparties,
  chain,
  linkable,
}: {
  counterparties: CounterpartySummary[];
  chain: Chain;
  linkable: boolean;
}) {
  if (counterparties.length === 0) return <EmptyState title="沒有交易對手資料" compact />;
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line scroll-thin">
      <table className="w-full min-w-[860px] text-left text-xs">
        <caption className="sr-only">往來金額前 20 名交易對手</caption>
        <thead className="bg-raised text-ink-3">
          <tr>
            <th scope="col" className="px-2.5 py-2 font-medium">#</th>
            <th scope="col" className="px-2.5 py-2 font-medium">交易對手</th>
            <th scope="col" className="px-2.5 py-2 font-medium">標籤</th>
            <th scope="col" className="px-2.5 py-2 text-right font-medium">流入</th>
            <th scope="col" className="px-2.5 py-2 text-right font-medium">流出</th>
            <th scope="col" className="px-2.5 py-2 text-right font-medium">筆數</th>
            <th scope="col" className="px-2.5 py-2 font-medium">往來期間</th>
            <th scope="col" className="px-2.5 py-2 font-medium">風險係數</th>
            {linkable && <th scope="col" className="px-2.5 py-2 font-medium"><span className="sr-only">動作</span></th>}
          </tr>
        </thead>
        <tbody>
          {counterparties.map((c, i) => {
            const tier = c.sanctioned ? 'critical' : riskTier(c.risk, c.labels.length > 0);
            return (
              <tr key={c.address} className="border-t border-line align-middle hover:bg-raised/40">
                <td className="tabular px-2.5 py-1.5 text-ink-3">{i + 1}</td>
                <td className="px-2.5 py-1.5">
                  <AddressText address={c.address} chain={chain} linkable={linkable} />
                </td>
                <td className="max-w-[240px] px-2.5 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {c.sanctioned && <Tag tone="danger">OFAC 制裁</Tag>}
                    {c.labels.map((l, j) => (
                      <LabelChip key={j} label={l} compact />
                    ))}
                    {!c.sanctioned && c.labels.length === 0 && <span className="text-ink-3">—</span>}
                  </span>
                </td>
                <td className="tabular whitespace-nowrap px-2.5 py-1.5 text-right text-ink">{fmtUsdCompact(c.inUsd)}</td>
                <td className="tabular whitespace-nowrap px-2.5 py-1.5 text-right text-ink">{fmtUsdCompact(c.outUsd)}</td>
                <td className="tabular px-2.5 py-1.5 text-right text-ink-2">{fmtInt(c.txCount)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-ink-2">
                  {fmtDate(c.firstTs)}
                  {c.lastTs !== c.firstTs && ` ~ ${fmtDate(c.lastTs)}`}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <TierDot tier={tier} />
                    <span className="tabular">{c.risk.toFixed(2)}</span>
                  </span>
                </td>
                {linkable && (
                  <td className="px-2.5 py-1.5">
                    <Link
                      href={`/investigate?chain=${chain}&address=${encodeURIComponent(c.address)}`}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-accent-ink hover:bg-raised"
                      title="調查此交易對手"
                    >
                      <ScanSearch className="size-3.5" aria-hidden />
                      調查
                    </Link>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
