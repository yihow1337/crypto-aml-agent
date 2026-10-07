'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtAmount, fmtUsd, type AnomalyResult, type Chain, type NormTx } from '@aml/engine';
import { ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, ArrowUpDown, ArrowUpRight, Download, Search, X } from 'lucide-react';
import { AddressText, HashText } from '@/components/ui/Address';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/feedback';
import type { AnalysisLookups } from '@/lib/analysis';
import { cn } from '@/lib/cn';
import { downloadText } from '@/lib/download';
import { fmtDateTime } from '@/lib/format';
import { inkOn, seqColor } from '@/lib/theme';

const PAGE_SIZE = 25;
type SortKey = 'ts' | 'usd' | 'amount' | 'score';
type DirFilter = 'all' | 'in' | 'out' | 'self';

const DIR_META = {
  in: { label: '轉入', icon: ArrowDownLeft, cls: 'text-[#86b6ef]' },
  out: { label: '轉出', icon: ArrowUpRight, cls: 'text-[#ec835a]' },
  self: { label: '自轉', icon: ArrowLeftRight, cls: 'text-ink-3' },
} as const;

interface Row {
  i: number;
  tx: NormTx;
  score?: number;
  reason?: string;
  rules: string[];
  label?: string;
}

export function TxTable({
  txs,
  chain,
  linkable,
  anomaly,
  range,
  lookups,
  focus,
}: {
  txs: NormTx[];
  chain: Chain;
  linkable: boolean;
  anomaly: AnomalyResult | null;
  range: [number, number];
  lookups: AnalysisLookups;
  /** Set from the scatter plot: filter the table to one hash. */
  focus?: { hash: string; nonce: number } | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [desc, setDesc] = useState(true);
  const [dir, setDir] = useState<DirFilter>('all');
  const [query, setQuery] = useState('');
  const [onlyRules, setOnlyRules] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [page, setPage] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    setQuery(focus.hash);
    setDir('all');
    setOnlyRules(false);
    setOnlyFlagged(false);
    setPage(0);
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  const rows = useMemo<Row[]>(() => {
    const reasons = new Map((anomaly?.flagged ?? []).map((f) => [f.hash, f.reason]));
    return txs.map((tx, i) => ({
      i,
      tx,
      score: anomaly?.scores[tx.hash],
      reason: reasons.get(tx.hash),
      rules: lookups.rulesOfTx(tx.hash),
      label: lookups.labelOf(tx.counterparty),
    }));
  }, [txs, anomaly, lookups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (dir !== 'all' && r.tx.direction !== dir) return false;
      if (onlyRules && r.rules.length === 0) return false;
      if (onlyFlagged && !r.reason) return false;
      if (q) {
        const hay = `${r.tx.hash} ${r.tx.counterparty} ${r.label ?? ''} ${r.tx.asset.symbol} ${r.rules.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const val = (r: Row): number => {
      switch (sortKey) {
        case 'ts':
          return r.tx.ts;
        case 'usd':
          return r.tx.usd ?? -1;
        case 'amount':
          return r.tx.amount;
        case 'score':
          return r.score ?? -1;
      }
    };
    out.sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)) || a.i - b.i);
    return out;
  }, [rows, dir, onlyRules, onlyFlagged, query, sortKey, desc]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setDesc((d) => !d);
    else {
      setSortKey(k);
      setDesc(true);
    }
    setPage(0);
  };

  const exportCsv = () => {
    const head = ['time_utc', 'direction', 'counterparty', 'label', 'amount', 'symbol', 'usd', 'rules', 'if_score', 'if_flag', 'status', 'hash'];
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((r) =>
      [
        new Date(r.tx.ts * 1000).toISOString(),
        r.tx.direction,
        r.tx.counterparty,
        r.label ?? '',
        r.tx.amount,
        r.tx.asset.symbol,
        r.tx.usd ?? '',
        r.rules.join(' '),
        r.score !== undefined ? r.score.toFixed(4) : '',
        r.reason ?? '',
        r.tx.status,
        r.tx.hash,
      ]
        .map(cell)
        .join(','),
    );
    downloadText(`transactions-${chain}.csv`, '﻿' + [head.join(','), ...lines].join('\n'), 'text/csv;charset=utf-8');
  };

  const [lo, hi] = range;
  const norm = (s: number) => (s - lo) / (hi - lo || 1);

  return (
    <div ref={rootRef} className="scroll-mt-28">
      {/* Filters: one row above the table they scope. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">搜尋交易</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="搜尋雜湊、地址、標籤、規則…"
            className="h-8 w-full rounded-lg border border-line-strong bg-sunken pl-8 pr-8 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
              aria-label="清除搜尋"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        <label className="sr-only" htmlFor="tx-dir">
          方向
        </label>
        <select
          id="tx-dir"
          value={dir}
          onChange={(e) => {
            setDir(e.target.value as DirFilter);
            setPage(0);
          }}
          className="h-8 rounded-lg border border-line-strong bg-sunken px-2 text-xs text-ink focus:border-accent focus:outline-none"
        >
          <option value="all">全部方向</option>
          <option value="in">轉入</option>
          <option value="out">轉出</option>
          <option value="self">自轉</option>
        </select>
        <ToggleChip checked={onlyRules} onChange={(v) => { setOnlyRules(v); setPage(0); }}>
          僅規則命中
        </ToggleChip>
        <ToggleChip checked={onlyFlagged} onChange={(v) => { setOnlyFlagged(v); setPage(0); }} disabled={!anomaly || anomaly.insufficient}>
          僅 ML 異常
        </ToggleChip>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={filtered.length === 0} className="ml-auto">
          <Download className="size-3.5" aria-hidden />
          CSV
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={txs.length === 0 ? '沒有交易紀錄' : '沒有符合篩選條件的交易'} compact />
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line scroll-thin">
          <table className="w-full min-w-[980px] text-left text-xs">
            <caption className="sr-only">交易明細（時間為台北時間）</caption>
            <thead className="bg-raised text-ink-3">
              <tr>
                <SortTh label="時間（台北）" k="ts" sortKey={sortKey} desc={desc} onSort={toggleSort} />
                <th scope="col" className="px-2.5 py-2 font-medium">方向</th>
                <th scope="col" className="px-2.5 py-2 font-medium">交易對手</th>
                <SortTh label="金額" k="amount" sortKey={sortKey} desc={desc} onSort={toggleSort} align="right" />
                <SortTh label="USD" k="usd" sortKey={sortKey} desc={desc} onSort={toggleSort} align="right" />
                <th scope="col" className="px-2.5 py-2 font-medium">規則</th>
                <SortTh label="ML 異常分數" k="score" sortKey={sortKey} desc={desc} onSort={toggleSort} align="center" />
                <th scope="col" className="px-2.5 py-2 font-medium">交易雜湊</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const meta = DIR_META[r.tx.direction];
                const DirIcon = meta.icon;
                const bg = r.score !== undefined ? seqColor(norm(r.score)) : undefined;
                return (
                  <tr key={`${r.tx.hash}-${r.i}`} className={cn('border-t border-line align-middle hover:bg-raised/40', r.tx.status === 'failed' && 'opacity-60')}>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-ink-2">{fmtDateTime(r.tx.ts)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1 text-ink-2">
                        <DirIcon className={cn('size-3.5', meta.cls)} aria-hidden />
                        {meta.label}
                      </span>
                      {r.tx.status === 'failed' && <Tag className="ml-1">失敗</Tag>}
                    </td>
                    <td className="max-w-[260px] px-2.5 py-1.5">
                      <AddressText address={r.tx.counterparty} chain={chain} linkable={linkable} />
                      {r.label && <div className="truncate text-[11px] text-ink-3" title={r.label}>{r.label}</div>}
                    </td>
                    <td className="tabular whitespace-nowrap px-2.5 py-1.5 text-right text-ink">{fmtAmount(r.tx.amount, r.tx.asset.symbol)}</td>
                    <td className="tabular whitespace-nowrap px-2.5 py-1.5 text-right text-ink-2">{r.tx.usd !== undefined ? fmtUsd(r.tx.usd) : '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {r.rules.length ? r.rules.map((id) => <Tag key={id} className="font-mono">{id}</Tag>) : <span className="text-ink-3">—</span>}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {r.score !== undefined && bg ? (
                        <span
                          className="tabular inline-flex min-w-14 items-center justify-center gap-1 rounded px-1.5 py-0.5 font-semibold"
                          style={{ backgroundColor: bg, color: inkOn(bg) }}
                          title={r.reason ? `異常標記：${r.reason}` : 'Isolation Forest 異常分數（越高越異常）'}
                        >
                          {r.reason && <span aria-label="異常標記">◆</span>}
                          {r.score.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <HashText hash={r.tx.hash} chain={chain} linkable={linkable} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span>
          共 {txs.length} 筆{filtered.length !== txs.length ? `，篩選後 ${filtered.length} 筆` : ''}；
          ◆ 為 Isolation Forest 標記，色階越亮分數越高。
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0}>
              上一頁
            </Button>
            <span className="tabular">
              第 {current + 1} / {pages} 頁
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1}>
              下一頁
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

function SortTh({
  label,
  k,
  sortKey,
  desc,
  onSort,
  align = 'left',
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sortKey === k;
  const Icon = active ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
      className={cn('px-2.5 py-2 font-medium', align === 'right' && 'text-right', align === 'center' && 'text-center')}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 rounded hover:text-ink', active && 'text-ink')}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}

function ToggleChip({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'h-8 rounded-lg border px-2.5 text-xs transition-colors disabled:opacity-40',
        checked ? 'border-accent/60 bg-accent/15 text-ink' : 'border-line-strong bg-sunken text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
