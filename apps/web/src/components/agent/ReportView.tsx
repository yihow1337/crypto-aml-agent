'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Download, ExternalLink, FileText, Printer, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/badges';
import { downloadJson, downloadText } from '@/lib/download';
import { fileStamp, fmtDateTime } from '@/lib/format';
import { Markdown } from './Markdown';

export interface ReportViewProps {
  markdown: string;
  source: 'glm' | 'template';
  model?: string;
  guard?: { scoreFixed: boolean; unverifiedRefs: number };
  investigationId?: string | null;
  /** Shown in the print header, e.g. "ETH 0x098B…2f96". */
  subjectLine: string;
  /** Base for download filenames (no extension). */
  filenameBase: string;
  /** Builds the JSON export (analysis + report). */
  buildExport: () => unknown;
  /** Link to the saved report page when an id is available. */
  showReportLink?: boolean;
  createdAt?: number;
}

export function SourceBadge({ source, model }: { source: 'glm' | 'template'; model?: string }) {
  return source === 'glm' ? (
    <Tag tone="accent" title="由 Z.ai GLM 依工具查得之資料撰寫，分數由程式計算">
      <Sparkles className="size-3" aria-hidden />
      GLM 生成{model ? ` · ${model}` : ''}
    </Tag>
  ) : (
    <Tag tone="warn" title="LLM 無法使用時，改以規則模板產生報告">
      <FileText className="size-3" aria-hidden />
      規則模板（LLM 不可用）
    </Tag>
  );
}

export function ReportView({
  markdown,
  source,
  model,
  guard,
  investigationId,
  subjectLine,
  filenameBase,
  buildExport,
  showReportLink = true,
  createdAt,
}: ReportViewProps) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('print-report');
    const finish = () => setPrinting(false);
    window.addEventListener('afterprint', finish);
    // Let the portal render before opening the print dialog.
    // The portal stays mounted until `afterprint`, so non-blocking print() implementations
    // still capture it; on screen #print-root is display:none.
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('print-report');
    };
  }, [printing]);

  const stamp = fileStamp();
  return (
    <div className="min-w-0">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <SourceBadge source={source} model={model} />
        {guard?.scoreFixed && (
          <Tag tone="good" title="風險分數與評分卡由程式產生並置於報告開頭，LLM 無法改寫">
            <ShieldCheck className="size-3" aria-hidden />
            分數由程式鎖定
          </Tag>
        )}
        {guard && guard.unverifiedRefs > 0 && (
          <Tag tone="warn" title="報告中出現未經工具查證的地址，已加註「未驗證」">
            <TriangleAlert className="size-3" aria-hidden />
            {guard.unverifiedRefs} 個未驗證地址已標註
          </Tag>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => downloadText(`${filenameBase}-${stamp}.md`, markdown, 'text/markdown;charset=utf-8')}>
            <Download className="size-3.5" aria-hidden />
            下載 Markdown
          </Button>
          <Button size="sm" onClick={() => downloadJson(`${filenameBase}-${stamp}.json`, buildExport())}>
            <Download className="size-3.5" aria-hidden />
            下載 JSON
          </Button>
          <Button size="sm" onClick={() => setPrinting(true)}>
            <Printer className="size-3.5" aria-hidden />
            列印 / 存成 PDF
          </Button>
          {showReportLink && investigationId && (
            <Link
              href={`/reports?id=${encodeURIComponent(investigationId)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-accent-ink hover:bg-raised"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              在調查報告頁開啟
            </Link>
          )}
        </span>
      </div>

      <article className="rounded-lg border border-line bg-sunken/60 px-4 py-5 sm:px-6">
        <Markdown>{markdown}</Markdown>
      </article>

      {printing &&
        createPortal(
          <div id="print-root">
            <header className="print-meta mb-6 border-b pb-3 text-sm">
              <div className="text-lg font-bold">Crypto AML Agent — 地址風險調查報告</div>
              <div>調查對象：{subjectLine}</div>
              <div>
                報告來源：{source === 'glm' ? `GLM 生成${model ? `（${model}）` : ''}` : '規則模板（LLM 不可用）'}
                {investigationId ? ` ・ 編號 ${investigationId}` : ''}
              </div>
              <div>列印時間：{fmtDateTime(Date.now())}（台北時間）{createdAt ? ` ・ 產生時間 ${fmtDateTime(createdAt)}` : ''}</div>
            </header>
            <Markdown>{markdown}</Markdown>
            <footer className="print-meta mt-8 border-t pt-3 text-xs">
              本系統為課程專題展示，僅供風險評估參考，不構成法律意見；地址標籤與制裁名單可能不完整。
            </footer>
          </div>,
          document.body,
        )}
    </div>
  );
}
