'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Info, LoaderCircle, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import { describeError, toApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised/80', className)} />;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-2">
      <LoaderCircle className={cn('size-4 animate-spin text-accent-ink', className)} aria-hidden />
      {label ?? <span className="sr-only">載入中</span>}
    </span>
  );
}

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  children,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong/80 text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      <Icon className={cn('text-ink-3', compact ? 'size-5' : 'size-7')} aria-hidden />
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {description && <p className="max-w-md text-xs text-ink-3">{description}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Live countdown (seconds) for rate-limit retries. */
function useCountdown(seconds: number | undefined): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return;
    const end = Date.now() + seconds * 1000;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) window.clearInterval(t);
    }, 500);
    return () => window.clearInterval(t);
  }, [seconds]);
  return left;
}

/** Friendly zh-TW error banner for any thrown value (ApiError aware). */
export function ErrorBanner({
  error,
  onRetry,
  className,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  const e = toApiError(error);
  const desc = describeError(e);
  const left = useCountdown(e.code === 'RATE_LIMITED' ? e.retryAfter : undefined);
  const Icon = e.code === 'NETWORK_ERROR' ? WifiOff : e.code === 'RATE_LIMITED' ? TriangleAlert : CircleAlert;
  const message =
    e.code === 'RATE_LIMITED' && e.retryAfter !== undefined
      ? left > 0
        ? `請求過於頻繁，請於 ${left} 秒後再試。`
        : '可以重新嘗試了。'
      : desc.title;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-risk-critical/45 bg-risk-critical/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-risk-critical" aria-hidden />
        <div className="min-w-0">
          {title && <p className="text-sm font-semibold text-ink">{title}</p>}
          <p className="text-sm text-ink">{message}</p>
          {desc.detail && <p className="mt-0.5 break-words text-xs text-ink-3">{desc.detail}</p>}
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">
            {e.code}
            {e.status ? ` · HTTP ${e.status}` : ''}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry} disabled={left > 0} className="self-start sm:self-center">
          <RefreshCw className="size-3.5" aria-hidden />
          {left > 0 ? `${left} 秒後重試` : '重試'}
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  icon,
  children,
  className,
}: {
  tone?: 'info' | 'warn';
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = icon ?? (tone === 'warn' ? TriangleAlert : Info);
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm',
        tone === 'info' && 'border-accent/35 bg-accent/8 text-ink-2',
        tone === 'warn' && 'border-risk-medium/40 bg-risk-medium/8 text-ink-2',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', tone === 'warn' ? 'text-risk-medium' : 'text-accent-ink')}
        aria-hidden
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
