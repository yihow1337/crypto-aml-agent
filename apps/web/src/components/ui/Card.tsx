import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CardProps {
  id?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
}

export function Card({
  id,
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
}: CardProps) {
  const hasHeader = title || subtitle || actions;
  return (
    <Tag
      id={id}
      className={cn('min-w-0 scroll-mt-28 rounded-xl border border-line bg-surface shadow-sm shadow-black/20', className)}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                {Icon && <Icon className="size-4 shrink-0 text-accent-ink" aria-hidden />}
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-ink">
          {Icon && <Icon className="size-6 text-accent-ink" aria-hidden />}
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small label/value pair used in headers. */
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}
