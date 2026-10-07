import { LEVEL_ZH, type AnalysisResult, type Severity } from '@aml/engine';
import { ArrowDown, ShieldCheck } from 'lucide-react';
import { RISK_BG, SeverityChip } from '@/components/ui/badges';
import { EmptyState, Notice } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';

/** Per-rule points on the 0–100 score scale, plus the statistical lift and floor note. */
export function ScoreBreakdown({ data }: { data: AnalysisResult }) {
  const sevById = new Map<string, Severity>(data.hits.map((h) => [h.id, h.severity]));
  const items = data.breakdown.filter((b) => b.points > 0.05);
  const preFloor = data.sRules + data.statsLift;

  return (
    <div className="flex h-full flex-col gap-4">
      <ol className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4" aria-label="分數計算步驟">
        <Step label="規則分數 S_rules" value={data.sRules.toFixed(1)} />
        <Step label="統計異常加成" value={`+${data.statsLift.toFixed(1)}`} hint={`異常指數 A = ${data.stats.anomalyIndex.toFixed(2)}`} />
        <Step label="套用下限前" value={preFloor.toFixed(1)} />
        <Step label="最終風險分數" value={String(data.score)} hint={`${LEVEL_ZH[data.level]}風險`} strong />
      </ol>

      {items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="未觸發任何偵測規則" description="規則分數為 0；最終分數僅來自統計異常加成。" compact />
      ) : (
        <ul className="space-y-2.5" aria-label="各規則對分數的貢獻（0–100 尺度）">
          {items.map((b) => {
            const sev = sevById.get(b.id) ?? 'low';
            return (
              <li key={b.id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-ink-3">{b.id}</span>
                    <span className="truncate text-ink">{b.title}</span>
                    <SeverityChip level={sev} size="xs" />
                  </span>
                  <span className="tabular shrink-0 font-semibold text-ink">+{b.points.toFixed(1)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-raised" aria-hidden>
                  <div
                    className={cn('h-2 rounded-full', RISK_BG[sev])}
                    style={{ width: `${Math.max(1.5, Math.min(100, b.points))}%` }}
                  />
                </div>
              </li>
            );
          })}
          {data.statsLift > 0.05 && (
            <li>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-2">統計異常加成（MAD 離群、爆量、短間隔）</span>
                <span className="tabular shrink-0 font-semibold text-ink">+{data.statsLift.toFixed(1)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-raised" aria-hidden>
                <div className="h-2 rounded-full bg-ink-3" style={{ width: `${Math.max(1.5, data.statsLift)}%` }} />
              </div>
            </li>
          )}
        </ul>
      )}

      {data.floorApplied && (
        <Notice tone="warn" icon={ArrowDown}>
          已套用嚴重度下限：<span className="font-medium text-ink">{data.floorApplied}</span>
          。下限確保觸發嚴重規則時分數不會被稀釋。
        </Notice>
      )}
      <p className="mt-auto text-xs text-ink-3">
        條長以 0–100 分數尺度表示各規則貢獻（依 noisy-OR 合成後按比例分配）；減權規則已乘以 ×0.3。
      </p>
    </div>
  );
}

function Step({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <li className={cn('rounded-lg border px-2 py-2', strong ? 'border-accent/50 bg-accent/10' : 'border-line bg-sunken')}>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cn('text-lg font-bold text-ink', strong && 'text-xl')}>{value}</div>
      {hint && <div className="text-[11px] text-ink-3">{hint}</div>}
    </li>
  );
}
