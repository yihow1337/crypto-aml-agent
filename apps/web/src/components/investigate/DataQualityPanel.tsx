import type { AnalyzeResponse } from '@aml/engine';
import { Database, Info, TriangleAlert } from 'lucide-react';
import { Tag } from '@/components/ui/badges';

export function DataQualityPanel({ data }: { data: AnalyzeResponse }) {
  const dq = data.dataQuality;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <Database className="size-3.5 text-ink-3" aria-hidden />
          資料來源
        </h3>
        {dq.sources.length ? (
          <div className="flex flex-wrap gap-1.5">
            {dq.sources.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-3">{data.mode === 'scenario' ? '合成情境資料（引擎內建）' : '—'}</p>
        )}
        {dq.truncated && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-risk-medium" aria-hidden />
            交易紀錄已截斷：僅分析最近一段資料（受 API 分頁上限限制）。
          </p>
        )}
      </div>
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <Info className="size-3.5 text-ink-3" aria-hidden />
          資料品質說明
        </h3>
        {dq.notes.length ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-2">
            {dq.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">無特別說明。</p>
        )}
      </div>
    </div>
  );
}
