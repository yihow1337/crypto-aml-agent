'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: '儀表板', icon: LayoutDashboard },
  { href: '/investigate', label: '地址調查', icon: ScanSearch },
  { href: '/scenarios', label: '洗錢情境', icon: FlaskConical },
  { href: '/watchlist', label: '監控名單', icon: ListChecks },
  { href: '/reports', label: '調查報告', icon: FileText },
  { href: '/methodology', label: '方法說明', icon: BookOpen },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur supports-[backdrop-filter]:bg-page/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 pt-3 sm:px-6 lg:flex-row lg:items-center lg:gap-8 lg:py-3">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Crypto AML Agent 首頁">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/40">
            <ShieldCheck className="size-5 text-accent-ink" aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[15px] font-bold tracking-wide text-ink">Crypto AML Agent</span>
            <span className="block truncate text-xs text-ink-3">AI 鏈上風險監控與異常交易偵測</span>
          </span>
        </Link>
        <nav aria-label="主選單" className="-mx-4 relative overflow-x-auto px-4 scroll-thin lg:mx-0 lg:px-0">
          <ul className="flex min-w-max items-center gap-1 pb-2 lg:pb-0">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-accent/15 font-semibold text-ink ring-1 ring-accent/40'
                        : 'text-ink-2 hover:bg-raised hover:text-ink',
                    )}
                  >
                    <Icon className={cn('size-4', active ? 'text-accent-ink' : 'text-ink-3')} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
