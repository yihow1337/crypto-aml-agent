'use client';

import { CHAIN_ZH, fmtAmount, fmtUsd, type AnalyzeResponse } from '@aml/engine';
import { Database, FlaskConical, RefreshCw, Radio } from 'lucide-react';
import { AddressText } from '@/components/ui/Address';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Card';
import { ChainBadge, LabelChip, SeverityChip, Tag } from '@/components/ui/badges';
import { fmtDateTime, fmtInt, fmtRelative, fmtUsdCompact } from '@/lib/format';
import { WatchlistQuickAdd } from './WatchlistQuickAdd';

export function SubjectHeader({
  data,
  onReload,
  reloading,
}: {
  data: AnalyzeResponse;
  onReload?: () => void;
  reloading?: boolean;
}) {
  const { profile, stats, subject } = data;
  const live = data.mode === 'live';
  const first = profile.firstSeen ?? stats.firstTs;
  const last = profile.lastSeen ?? stats.lastTs;
  return (
    <section
      aria-label="調查對象"
      className="min-w-0 rounded-xl border border-line bg-gradient-to-br from-surface to-[#0f1a30] p-4 shadow-sm shadow-black/20 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChainBadge chain={subject.chain} full />
        {live ? (
          <Tag tone="accent">
            <Radio className="size-3" aria-hidden />
            即時鏈上資料
          </Tag>
        ) : (
          <Tag tone="warn">
            <FlaskConical className="size-3" aria-hidden />
            情境模擬（合成資料）
          </Tag>
        )}
        {data.cached && (
          <Tag title="結果來自後端快取">
            <Database className="size-3" aria-hidden />
            快取
          </Tag>
        )}
        {profile.isContract && <Tag>合約地址</Tag>}
        <span className="ml-auto flex items-center gap-2">
          <SeverityChip level={data.level} suffix={`風險 · ${data.score}`} size="sm" />
        </span>
      </div>

      <div className="mt-3 min-w-0">
        <h2 className="sr-only">調查對象地址</h2>
        <AddressText
          address={subject.address}
          chain={subject.chain}
          linkable={live}
          full
          textClassName="text-base sm:text-lg font-semibold"
        />
      </div>

      {profile.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {profile.labels.map((l, i) => (
            <LabelChip key={`${l.name}-${i}`} label={l} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-3">無已知標籤（未出現在策展標籤、Blockscout 標記或 OFAC 名單中）</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/70 pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="餘額">
          {profile.balance !== undefined ? (
            <span className="tabular" title={fmtUsd(profile.balanceUsd)}>
              {fmtAmount(profile.balance, profile.nativeSymbol)}
            </span>
          ) : (
            '—'
          )}
          {profile.balanceUsd !== undefined && (
            <span className="ml-1 text-xs text-ink-3">≈ {fmtUsdCompact(profile.balanceUsd)}</span>
          )}
        </Field>
        <Field label="交易筆數（分析 / 總計）">
          <span className="tabular">
            {fmtInt(stats.n)} / {profile.txCount !== undefined ? fmtInt(profile.txCount) : '—'}
          </span>
        </Field>
        <Field label="首次出現">{first ? fmtDateTime(first) : '—'}</Field>
        <Field label="最近活動">
          {last ? (
            <span title={fmtDateTime(last)}>
              {fmtDateTime(last)}
              {Date.now() / 1000 - last < 30 * 86400 && <span className="ml-1 text-xs text-ink-3">（{fmtRelative(last)}）</span>}
            </span>
          ) : (
            '—'
          )}
        </Field>
        <Field label="流入 / 流出">
          <span className="tabular">
            {fmtUsdCompact(stats.inUsd)} / {fmtUsdCompact(stats.outUsd)}
          </span>
        </Field>
        <Field label="交易對手數">
          <span className="tabular">{fmtInt(stats.uniqueCounterparties)}</span>
        </Field>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span>
          {CHAIN_ZH[subject.chain]} · 分析時間 {fmtDateTime(data.generatedAt)}（台北時間）· 引擎 v{data.engineVersion}
        </span>
        <span className="no-print flex flex-wrap gap-2">
          {live && <WatchlistQuickAdd chain={subject.chain} address={subject.address} defaultLabel={profile.labels[0]?.name} />}
          {onReload && (
            <Button size="sm" variant="ghost" onClick={onReload} disabled={reloading}>
              <RefreshCw className={reloading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
              重新分析
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}
