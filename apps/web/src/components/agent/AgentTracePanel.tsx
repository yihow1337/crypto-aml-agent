'use client';

import { useEffect, useState } from 'react';
import { LEVEL_ZH } from '@aml/engine';
import { Bot, CircleCheck, CircleX, LoaderCircle, TriangleAlert, Wrench } from 'lucide-react';
import { RiskGauge } from '@/components/charts/RiskGauge';
import { SeverityChip, Tag } from '@/components/ui/badges';
import { PHASE_ZH, toolZh, type AgentView } from '@/lib/agent';
import { cn } from '@/lib/cn';
import { fmtArgs, fmtMs } from '@/lib/format';

/** Ticking elapsed time while the agent runs. */
function useElapsed(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}

export function AgentTracePanel({
  view,
  running,
  startedAt = null,
  showAnalysis = true,
}: {
  view: AgentView;
  running: boolean;
  startedAt?: number | null;
  showAnalysis?: boolean;
}) {
  const elapsed = useElapsed(startedAt, running);
  const duration = view.done?.durationMs ?? (startedAt ? elapsed : undefined);
  const b = view.budget;
  const pct = b && b.limit > 0 ? Math.min(100, (b.subrequests / b.limit) * 100) : 0;
  const okSteps = view.steps.filter((s) => s.result?.ok).length;

  return (
    <div className="space-y-4">
      {/* Budget meter + run stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line bg-sunken px-2 py-2">
          <div className="text-[11px] text-ink-3">工具呼叫</div>
          <div className="text-lg font-bold text-ink">
            {okSteps}
            <span className="text-xs font-normal text-ink-3"> / {view.steps.length}</span>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-sunken px-2 py-2">
          <div className="text-[11px] text-ink-3">LLM 輪數</div>
          <div className="text-lg font-bold text-ink">{b ? b.llmTurns : '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-sunken px-2 py-2">
          <div className="text-[11px] text-ink-3">耗時</div>
          <div className="text-lg font-bold text-ink">{duration !== undefined ? fmtMs(duration) : '—'}</div>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-ink-2">子請求預算（Cloudflare Worker subrequests）</span>
          <span className="tabular text-ink">{b ? `${b.subrequests} / ${b.limit}` : '—'}</span>
        </div>
        <div
          className="h-2 rounded-full bg-accent/20"
          role="meter"
          aria-label="子請求預算使用量"
          aria-valuemin={0}
          aria-valuemax={b?.limit ?? 0}
          aria-valuenow={b?.subrequests ?? 0}
        >
          <div
            className={cn('h-2 rounded-full transition-all', pct >= 90 ? 'bg-risk-critical' : pct >= 70 ? 'bg-risk-medium' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {showAnalysis && view.analysis && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-sunken p-2">
          <div className="w-32 shrink-0">
            <RiskGauge score={view.analysis.score} level={view.analysis.level} height={110} compact />
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-ink-3">程式計算之風險分數（LLM 不得更改）</p>
            <SeverityChip level={view.analysis.level} suffix={`風險 · ${view.analysis.score} 分`} />
            <div className="flex flex-wrap gap-1">
              {view.analysis.hits.slice(0, 8).map((h) => (
                <Tag key={h.id} title={`${h.title}（${LEVEL_ZH[h.severity]}）`}>
                  {h.id}
                </Tag>
              ))}
              {view.analysis.hits.length === 0 && <span className="text-xs text-ink-3">未觸發規則</span>}
            </div>
          </div>
        </div>
      )}

      {/* Step list */}
      <ol className="relative space-y-2 border-l border-line pl-4" aria-label="Agent 執行軌跡">
        {view.items.map((it) => {
          if (it.kind === 'status') {
            return (
              <li key={it.key} className="relative text-xs">
                <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />
                <span className="mr-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">
                  {PHASE_ZH[it.phase] ?? it.phase}
                </span>
                <span className="text-ink-2">{it.message}</span>
              </li>
            );
          }
          if (it.kind === 'thinking') {
            return (
              <li key={it.key} className="relative text-xs">
                <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden />
                <span className="flex items-start gap-1.5 italic text-ink-3">
                  <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="line-clamp-3">{it.text}</span>
                </span>
              </li>
            );
          }
          if (it.kind === 'error') {
            return (
              <li
                key={it.key}
                className={cn(
                  'relative rounded-md border px-2.5 py-1.5 text-xs',
                  it.recoverable ? 'border-risk-medium/40 bg-risk-medium/8' : 'border-risk-critical/45 bg-risk-critical/10',
                )}
              >
                <span className="absolute -left-[21px] top-2.5 size-2.5 rounded-full border-2 border-surface bg-risk-medium" aria-hidden />
                <span className="flex items-start gap-1.5 text-ink">
                  <TriangleAlert className={cn('mt-0.5 size-3.5 shrink-0', it.recoverable ? 'text-risk-medium' : 'text-risk-critical')} aria-hidden />
                  <span>
                    <span className="font-mono text-[11px] text-ink-3">{it.code}</span> {it.message}
                    {it.recoverable && <span className="text-ink-3">（可恢復：系統改用替代流程繼續）</span>}
                  </span>
                </span>
              </li>
            );
          }
          const s = it.step;
          const pending = !s.result;
          return (
            <li key={it.key} className="relative rounded-lg border border-line bg-sunken px-3 py-2">
              <span
                className={cn(
                  'absolute -left-[21px] top-3 size-2.5 rounded-full border-2 border-surface',
                  pending ? 'bg-ink-3' : s.result?.ok ? 'bg-risk-low' : 'bg-risk-critical',
                )}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Wrench className="size-3.5 text-ink-3" aria-hidden />
                <span className="text-sm font-medium text-ink">{toolZh(s.name)}</span>
                <span className="font-mono text-[11px] text-ink-3">{s.name}</span>
                {s.turn > 0 && <span className="text-[11px] text-ink-3">第 {s.turn} 輪</span>}
                <span className="ml-auto inline-flex items-center gap-1 text-xs">
                  {pending ? (
                    <>
                      <LoaderCircle className="size-3.5 animate-spin text-accent-ink" aria-hidden />
                      <span className="text-ink-2">執行中</span>
                    </>
                  ) : s.result?.ok ? (
                    <>
                      <CircleCheck className="size-3.5 text-risk-low" aria-hidden />
                      <span className="text-ink-2">成功</span>
                    </>
                  ) : (
                    <>
                      <CircleX className="size-3.5 text-risk-critical" aria-hidden />
                      <span className="text-ink-2">失敗</span>
                    </>
                  )}
                  {s.result && <span className="tabular text-ink-3">· {fmtMs(s.result.ms)}</span>}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-ink-3" title={JSON.stringify(s.args)}>
                {fmtArgs(s.args)}
              </p>
              {s.result?.summary && <p className="mt-1 text-xs text-ink-2">{s.result.summary}</p>}
            </li>
          );
        })}
        {running && (
          <li className="relative text-xs" aria-live="polite">
            <span className="absolute -left-[21px] top-1.5 size-2.5 animate-pulse rounded-full border-2 border-surface bg-accent" aria-hidden />
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <LoaderCircle className="size-3.5 animate-spin text-accent-ink" aria-hidden />
              Agent 執行中{view.phase ? `：${PHASE_ZH[view.phase] ?? view.phase}` : '…'}
            </span>
          </li>
        )}
        {!running && view.items.length === 0 && <li className="text-xs text-ink-3">尚無執行紀錄。</li>}
      </ol>
    </div>
  );
}
