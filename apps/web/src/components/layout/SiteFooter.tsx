import Link from 'next/link';
import { Scale } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="no-print mt-8 border-t border-line bg-sunken/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm sm:px-6 md:flex-row md:items-start md:justify-between">
        <p className="flex items-start gap-2 text-ink-2">
          <Scale className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <span>本系統為課程專題展示，僅供風險評估參考，不構成法律意見；地址標籤與制裁名單可能不完整。</span>
        </p>
        <p className="shrink-0 text-ink-3">
          Crypto AML Agent ·{' '}
          <Link href="/methodology" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
            方法說明
          </Link>
          {' · '}
          <Link href="/admin" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
            管理後台
          </Link>
        </p>
      </div>
    </footer>
  );
}
