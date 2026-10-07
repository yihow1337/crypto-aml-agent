'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CHAIN_ZH, LEVEL_ZH, shortAddress, type InvestigationDetail, type InvestigationSummary } from '@aml/engine';
import { ArrowLeft, Bot, FileText, FlaskConical, Radio, RefreshCw, ScanSearch } from 'lucide-react';
import { AgentTracePanel } from '@/components/agent/AgentTracePanel';
import { ReportView, SourceBadge } from '@/components/agent/ReportView';
import { AddressText } from '@/components/ui/Address';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { ChainBadge, SeverityChip, Tag } from '@/components/ui/badges';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { buildAgentView } from '@/lib/agent';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtRelative } from '@/lib/format';

export function ReportsClient() {
  const params = useSearchParams();
  const id = params.get('id');
  return id ? <ReportDetail id={id} /> : <ReportList />;
}

function ReportList() {
  const list = useAsync((s) => api.investigations(20, s), []);
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="調查報告"
        icon={FileText}
        description="最近由 AI Agent 完成的地址調查。點擊即可檢視完整報告與工具呼叫軌跡，並下載 Markdown / JSON 或列印成 PDF。"
        actions={
          <Button size="sm" onClick={list.reload} disabled={list.loading}>
            <RefreshCw className={cn('size-3.5', list.loading && 'animate-spin')} aria-hidden />
            重新整理
          </Button>
        }
      />
      <Card title="最近的調查" icon={FileText} subtitle={list.data ? `顯示最近 ${items.length} 筆` : undefined} bodyClassName="p-0">
        {list.loading && !list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.error && !list.data ? (
          <ErrorBanner error={list.error} onRetry={list.reload} className="m-4" />
        ) : items.length === 0 ? (
          <EmptyState icon={Bot} title="尚無調查報告" description="在地址調查頁按「啟動 AI Agent 調查」，完成後報告會保存在這裡。" className="m-4">
            <Link href="/investigate" className={buttonClass('primary', 'sm')}>
              <ScanSearch className="size-3.5" aria-hidden />
              前往地址調查
            </Link>
          </EmptyState>
        ) : (
          <ReportTable items={items} />
        )}
      </Card>
    </div>
  );
}

function ReportTable({ items }: { items: InvestigationSummary[] }) {
  return (
    <div className="relative overflow-x-auto scroll-thin">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">最近的調查報告</caption>
        <thead className="bg-raised text-xs text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">時間</th>
            <th scope="col" className="px-3 py-2 font-medium">調查對象</th>
            <th scope="col" className="px-3 py-2 font-medium">模式</th>
            <th scope="col" className="px-3 py-2 font-medium">風險</th>
            <th scope="col" className="px-3 py-2 font-medium">報告來源</th>
            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">開啟</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-line align-middle hover:bg-raised/40">
              <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-2" title={fmtDateTime(r.createdAt)}>
                {fmtRelative(r.createdAt)}
                <span className="block text-[11px] text-ink-3">{fmtDateTime(r.createdAt)}</span>
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <ChainBadge chain={r.chain} />
                  <span className="font-mono text-xs text-ink" title={r.address}>
                    {shortAddress(r.address, 8, 6)}
                  </span>
                </span>
              </td>
              <td className="px-3 py-2">
                {r.mode === 'scenario' ? (
                  <Tag tone="warn">
                    <FlaskConical className="size-3" aria-hidden />
                    情境 {r.scenarioId?.toUpperCase()}
                  </Tag>
                ) : (
                  <Tag tone="accent">
                    <Radio className="size-3" aria-hidden />
                    即時
                  </Tag>
                )}
              </td>
              <td className="px-3 py-2">
                <SeverityChip level={r.level} suffix={` · ${r.score}`} size="xs" />
              </td>
              <td className="px-3 py-2">
                <SourceBadge source={r.source} model={r.model} />
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/reports?id=${encodeURIComponent(r.id)}`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-accent-ink hover:bg-raised"
                >
                  <FileText className="size-3.5" aria-hidden />
                  檢視報告
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportDetail({ id }: { id: string }) {
  const detail = useAsync((s) => api.investigation(id, s), [id]);
  const d = detail.data;
  return (
    <div className="space-y-6">
      <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        返回報告列表
      </Link>
      {detail.loading && !d ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : detail.error && !d ? (
        <ErrorBanner error={detail.error} onRetry={detail.reload} title={`無法載入報告 ${id}`} />
      ) : d ? (
        <DetailBody d={d} />
      ) : null}
    </div>
  );
}

function DetailBody({ d }: { d: InvestigationDetail }) {
  const view = useMemo(() => buildAgentView(d.trace ?? []), [d.trace]);
  const live = d.mode === 'live';
  const rerun = d.mode === 'scenario' && d.scenarioId
    ? `/investigate?scenario=${d.scenarioId}`
    : `/investigate?chain=${d.chain}&address=${encodeURIComponent(d.address)}`;
  return (
    <>
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ChainBadge chain={d.chain} full />
          {live ? (
            <Tag tone="accent">
              <Radio className="size-3" aria-hidden />
              即時鏈上資料
            </Tag>
          ) : (
            <Tag tone="warn">
              <FlaskConical className="size-3" aria-hidden />
              情境 {d.scenarioId?.toUpperCase()}（合成資料）
            </Tag>
          )}
          <SourceBadge source={d.source} model={d.model} />
          <span className="ml-auto">
            <SeverityChip level={d.level} suffix={`風險 · ${d.score}`} size="md" />
          </span>
        </div>
        <h1 className="sr-only">調查報告 {d.id}</h1>
        <div className="mt-3">
          <AddressText address={d.address} chain={d.chain} linkable={live} full textClassName="text-base sm:text-lg font-semibold" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {d.hits.map((h) => (
            <Tag key={h.id} title={`${h.title}（${LEVEL_ZH[h.severity]}）`}>
              <span className="font-mono">{h.id}</span> {h.title}
            </Tag>
          ))}
          {d.hits.length === 0 && <span className="text-xs text-ink-3">未觸發任何偵測規則</span>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-ink-3">
          <span>
            報告編號 <span className="font-mono text-ink-2">{d.id}</span> · 產生於 {fmtDateTime(d.createdAt)}（台北時間）
          </span>
          <Link href={rerun} className={buttonClass('secondary', 'sm')}>
            <ScanSearch className="size-3.5" aria-hidden />
            重新調查此地址
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card title="調查報告" icon={FileText} className="lg:col-span-8">
          {d.reportMd ? (
            <ReportView
              markdown={d.reportMd}
              source={d.source}
              model={d.model}
              guard={view.report?.guard}
              investigationId={d.id}
              subjectLine={`${CHAIN_ZH[d.chain]} ${d.address}${live ? '' : '（情境模擬）'}`}
              filenameBase={`aml-report-${d.chain}-${d.address.slice(0, 10)}`}
              buildExport={() => d}
              showReportLink={false}
              createdAt={d.createdAt}
            />
          ) : (
            <EmptyState icon={FileText} title="此筆調查沒有報告內容" />
          )}
        </Card>
        <Card title="Agent 執行軌跡" icon={Bot} className="lg:col-span-4" subtitle={`${d.trace?.length ?? 0} 個事件`}>
          {d.trace?.length ? (
            <AgentTracePanel view={view} running={false} />
          ) : (
            <EmptyState icon={Bot} title="沒有保存執行軌跡" compact />
          )}
        </Card>
      </div>
    </>
  );
}
