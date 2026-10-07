'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { CHAIN_ZH, type Chain, type WatchlistItem } from '@aml/engine';
import { CircleCheck, CircleX, ListChecks, Plus, RefreshCw, ScanSearch } from 'lucide-react';
import { useChainDetection, ChainPicker } from '@/components/investigate/AddressInput';
import { AddressText } from '@/components/ui/Address';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { ChainBadge, SeverityChip } from '@/components/ui/badges';
import { EmptyState, ErrorBanner, Notice, Skeleton } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api, describeError, toApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtRelative } from '@/lib/format';

const LABEL_MAX = 40;

export function WatchlistClient() {
  const list = useAsync((s) => api.watchlist(s), []);
  const items = list.data?.items ?? [];
  const max = list.data?.max;
  const full = max !== undefined && items.length >= max;

  return (
    <div className="space-y-6">
      <PageHeader
        title="監控名單"
        icon={ListChecks}
        description="加入監控的地址會由排程掃描（Cloudflare Cron Triggers）定期重新分析；風險升高或觸發新規則時，警示會出現在儀表板。"
        actions={
          <Button size="sm" onClick={list.reload} disabled={list.loading}>
            <RefreshCw className={cn('size-3.5', list.loading && 'animate-spin')} aria-hidden />
            重新整理
          </Button>
        }
      />

      <Card title="新增監控地址" icon={Plus} subtitle={max !== undefined ? `已使用 ${items.length} / ${max} 個名額` : undefined}>
        {full ? (
          <Notice tone="warn">監控名單已達上限（{max} 個地址）。為控制資料來源 API 用量，展示環境限制監控數量；移除地址需管理員權限。</Notice>
        ) : (
          <AddForm onAdded={list.reload} disabled={!list.data} />
        )}
      </Card>

      <Card title="監控中的地址" icon={ListChecks} subtitle={list.data ? `共 ${items.length} 個地址` : undefined} bodyClassName="p-0">
        {list.loading && !list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : list.error && !list.data ? (
          <ErrorBanner error={list.error} onRetry={list.reload} className="m-4" />
        ) : items.length === 0 ? (
          <EmptyState icon={ListChecks} title="監控名單是空的" description="在上方輸入地址加入監控，或在地址調查頁按「加入監控名單」。" className="m-4" />
        ) : (
          <WatchTable items={items} />
        )}
      </Card>
    </div>
  );
}

function WatchTable({ items }: { items: WatchlistItem[] }) {
  return (
    <div className="relative overflow-x-auto scroll-thin">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">監控中的地址</caption>
        <thead className="bg-raised text-xs text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">標籤</th>
            <th scope="col" className="px-3 py-2 font-medium">鏈</th>
            <th scope="col" className="px-3 py-2 font-medium">地址</th>
            <th scope="col" className="px-3 py-2 font-medium">最近風險</th>
            <th scope="col" className="px-3 py-2 font-medium">最近掃描</th>
            <th scope="col" className="px-3 py-2 font-medium">加入時間</th>
            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">動作</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id} className="border-t border-line align-middle hover:bg-raised/40">
              <td className="max-w-[220px] truncate px-4 py-2 text-ink" title={w.label}>
                {w.label || <span className="text-ink-3">—</span>}
              </td>
              <td className="px-3 py-2">
                <ChainBadge chain={w.chain} />
              </td>
              <td className="px-3 py-2">
                <AddressText address={w.address} chain={w.chain} linkable head={8} tail={6} />
              </td>
              <td className="px-3 py-2">
                {w.lastLevel ? (
                  <SeverityChip level={w.lastLevel} suffix={w.lastScore !== null ? ` · ${w.lastScore}` : ''} size="xs" />
                ) : (
                  <span className="text-xs text-ink-3">尚未評分</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2" title={w.lastScannedAt ? fmtDateTime(w.lastScannedAt) : undefined}>
                {w.lastScannedAt ? fmtRelative(w.lastScannedAt) : <span className="text-ink-3">尚未掃描</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">{fmtDateTime(w.createdAt)}</td>
              <td className="px-3 py-2">
                <Link
                  href={`/investigate?chain=${w.chain}&address=${encodeURIComponent(w.address)}`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-accent-ink hover:bg-raised"
                >
                  <ScanSearch className="size-3.5" aria-hidden />
                  調查
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddForm({ onAdded, disabled }: { onAdded: () => void; disabled?: boolean }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [preferred, setPreferred] = useState<Chain | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; detail?: string } | null>(null);
  const { candidates, chain } = useChainDetection(address, preferred);
  const addrId = useId();
  const labelId = useId();
  const invalid = address.trim().length > 0 && candidates.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chain || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const item = await api.addWatchlist({ chain, address: address.trim(), label: label.trim().slice(0, LABEL_MAX) });
      setResult({ ok: true, text: `已加入監控：${item.label || item.address}（${CHAIN_ZH[item.chain]}）` });
      setAddress('');
      setLabel('');
      setPreferred(null);
      onAdded();
    } catch (err) {
      const e2 = toApiError(err);
      const d = describeError(e2);
      setResult({
        ok: false,
        text: e2.code === 'QUOTA_EXCEEDED' ? '監控名單已達上限，無法再新增。' : d.title,
        detail: d.detail,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-7">
          <label htmlFor={addrId} className="mb-1 block text-xs text-ink-2">
            地址
          </label>
          <input
            id={addrId}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… / T… / bc1… / 1… / 3…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            className={cn(
              'h-10 w-full rounded-lg border bg-sunken px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2',
              invalid ? 'border-risk-critical/60 focus:ring-risk-critical/40' : 'border-line-strong focus:border-accent focus:ring-accent/30',
            )}
          />
        </div>
        <div className="md:col-span-5">
          <label htmlFor={labelId} className="mb-1 block text-xs text-ink-2">
            標籤（選填，最多 {LABEL_MAX} 字）
          </label>
          <input
            id={labelId}
            value={label}
            maxLength={LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：客戶 A 入金地址"
            className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs">
          {invalid && (
            <span className="inline-flex items-center gap-1 text-ink-2">
              <CircleX className="size-3.5 text-risk-critical" aria-hidden />
              無法辨識的地址格式
            </span>
          )}
          {chain && (
            <>
              <span className="text-ink-3">{candidates.length > 1 ? '鏈別：' : '自動偵測：'}</span>
              <ChainPicker candidates={candidates} value={chain} onChange={setPreferred} />
            </>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={!chain || busy || disabled} className="ml-auto">
          <Plus className="size-4" aria-hidden />
          {busy ? '新增中…' : '加入監控'}
        </Button>
      </div>
      {result && (
        <div
          role={result.ok ? 'status' : 'alert'}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
            result.ok ? 'border-risk-low/40 bg-risk-low/10' : 'border-risk-critical/45 bg-risk-critical/10',
          )}
        >
          {result.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-risk-low" aria-hidden />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0 text-risk-critical" aria-hidden />
          )}
          <span className="text-ink">
            {result.text}
            {result.detail && <span className="block text-xs text-ink-3">{result.detail}</span>}
          </span>
        </div>
      )}
    </form>
  );
}
