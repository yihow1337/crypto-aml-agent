import { CATEGORY_RISK, CATEGORY_ZH, CHAIN_ZH, LEVEL_ZH, type AddressLabel, type Chain, type RiskLevel } from '@aml/engine';
import { CircleAlert, OctagonAlert, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CHAIN_SHORT } from '@/lib/theme';

export const RISK_ICON: Record<RiskLevel, LucideIcon> = {
  low: ShieldCheck,
  medium: CircleAlert,
  high: TriangleAlert,
  critical: OctagonAlert,
};

const RISK_CHIP: Record<RiskLevel, string> = {
  low: 'border-risk-low/45 bg-risk-low/12',
  medium: 'border-risk-medium/45 bg-risk-medium/12',
  high: 'border-risk-high/50 bg-risk-high/12',
  critical: 'border-risk-critical/60 bg-risk-critical/18',
};

export const RISK_TEXT: Record<RiskLevel, string> = {
  low: 'text-risk-low',
  medium: 'text-risk-medium',
  high: 'text-risk-high',
  critical: 'text-risk-critical',
};

export const RISK_BG: Record<RiskLevel, string> = {
  low: 'bg-risk-low',
  medium: 'bg-risk-medium',
  high: 'bg-risk-high',
  critical: 'bg-risk-critical',
};

/** Risk level / severity chip: coloured icon + text label (never colour alone). */
export function SeverityChip({
  level,
  suffix = '',
  size = 'sm',
  className,
}: {
  level: RiskLevel;
  suffix?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const Icon = RISK_ICON[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium text-ink',
        RISK_CHIP[level],
        size === 'xs' && 'px-1.5 py-0 text-[11px]',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-3 py-1 text-sm',
        className,
      )}
    >
      <Icon className={cn(size === 'md' ? 'size-4' : 'size-3.5', RISK_TEXT[level])} aria-hidden />
      {LEVEL_ZH[level]}
      {suffix}
    </span>
  );
}

const CHAIN_DOT: Record<Chain, string> = {
  eth: 'bg-chain-eth',
  bsc: 'bg-chain-bsc',
  tron: 'bg-chain-tron',
  btc: 'bg-chain-btc',
};

export function ChainBadge({ chain, full = false, className }: { chain: Chain; full?: boolean; className?: string }) {
  return (
    <span
      title={CHAIN_ZH[chain]}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-sunken px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-ink-2',
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', CHAIN_DOT[chain])} aria-hidden />
      {full ? CHAIN_ZH[chain] : CHAIN_SHORT[chain]}
    </span>
  );
}

export type RiskTier = RiskLevel | 'unknown';

/** Tier for a counterparty/label given its 0–1 risk (unlabelled parties stay neutral). */
export function riskTier(risk: number, labelled: boolean): RiskTier {
  if (risk >= 0.75) return 'critical';
  if (risk >= 0.5) return 'high';
  if (risk >= 0.25) return 'medium';
  return labelled ? 'low' : 'unknown';
}

const TIER_DOT: Record<RiskTier, string> = {
  low: 'bg-risk-low',
  medium: 'bg-risk-medium',
  high: 'bg-risk-high',
  critical: 'bg-risk-critical',
  unknown: 'bg-ink-3',
};

/** Tier of a label category, derived from the engine's CATEGORY_RISK weights. */
export function categoryTier(category: AddressLabel['category']): RiskTier {
  return riskTier(CATEGORY_RISK[category] ?? 0, category !== 'other');
}

/** Address label chip: name + category, with a risk-tier dot. */
export function LabelChip({ label, compact = false }: { label: AddressLabel; compact?: boolean }) {
  const tier = categoryTier(label.category);
  return (
    <span
      title={`${label.name}｜${CATEGORY_ZH[label.category]}｜來源：${label.source}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-1.5 py-0.5 text-[11px] text-ink-2"
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', TIER_DOT[tier])} aria-hidden />
      <span className="truncate text-ink">{label.name}</span>
      {!compact && <span className="shrink-0 text-ink-3">{CATEGORY_ZH[label.category]}</span>}
    </span>
  );
}

export function TierDot({ tier, className }: { tier: RiskTier; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', TIER_DOT[tier], className)} aria-hidden />;
}

/** Neutral tag. */
export function Tag({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'good' | 'danger';
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'border-line-strong bg-raised text-ink-2',
        tone === 'accent' && 'border-accent/50 bg-accent/15 text-accent-ink',
        tone === 'warn' && 'border-risk-medium/45 bg-risk-medium/10 text-ink',
        tone === 'good' && 'border-risk-low/45 bg-risk-low/10 text-ink',
        tone === 'danger' && 'border-risk-critical/50 bg-risk-critical/12 text-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}
