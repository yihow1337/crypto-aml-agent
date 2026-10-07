import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-strong disabled:bg-accent/40 disabled:text-white/70 shadow-sm shadow-black/30',
  secondary: 'border border-line-strong bg-raised text-ink hover:border-accent/60 hover:bg-[#1c2a45] disabled:opacity-50',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-50',
  danger: 'border border-risk-critical/50 bg-risk-critical/15 text-ink hover:bg-risk-critical/25 disabled:opacity-50',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
