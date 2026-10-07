import type { Chain, RiskLevel } from '@aml/engine';

/**
 * Color tokens shared by charts (ECharts needs literal hex values) and mirrored as CSS
 * variables in globals.css. Values come from the dataviz reference palette, validated
 * against the navy card surface (#111a2c):
 * - risk levels use the fixed status scale (good / warning / serious / critical), always
 *   paired with an icon + text label;
 * - categorical slots 1–2 (dark steps) for inflow / outflow;
 * - the blue sequential ramp for Isolation-Forest anomaly scores.
 */
export const INK = {
  primary: '#e7edf6',
  secondary: '#b4c0d3',
  muted: '#8b98b0',
} as const;

export const SURFACE = {
  page: '#0b1220',
  card: '#111a2c',
  raised: '#17233a',
  grid: '#1e2a41',
  axis: '#2e3d5a',
  border: '#22304a',
} as const;

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: '#0ca30c',
  medium: '#fab219',
  high: '#ec835a',
  critical: '#d03b3b',
};

export const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * Counterparty volume tiers (ordinal). One blue hue, lighter = larger so the biggest flows stand
 * out on the dark card; the darkest step still clears 2:1 against #111a2c. Validated with the
 * dataviz ordinal check (monotone lightness, visible step gaps, single hue).
 */
export const AMOUNT_TIERS = [
  { max: 1_000, label: '未滿 US$1K', color: '#184f95' },
  { max: 10_000, label: 'US$1K–10K', color: '#2a78d6' },
  { max: 100_000, label: 'US$10K–100K', color: '#5598e7' },
  { max: 1_000_000, label: 'US$100K–1M', color: '#86b6ef' },
  { max: Infinity, label: 'US$1M 以上', color: '#cde2fb' },
] as const;

/** Index into AMOUNT_TIERS for a USD volume; invalid or negative values count as the smallest. */
export function amountTier(usd: number): number {
  if (!(usd > 0)) return 0;
  return AMOUNT_TIERS.findIndex((t) => usd < t.max);
}

export const CHAIN_COLOR: Record<Chain, string> = {
  eth: '#3987e5',
  bsc: '#c98500',
  tron: '#9085e9',
  btc: '#d95926',
};

export const CHAIN_SHORT: Record<Chain, string> = {
  eth: 'ETH',
  bsc: 'BSC',
  tron: 'TRON',
  btc: 'BTC',
};

/** Categorical slots 1 and 2 (dark-mode steps). */
export const SERIES = {
  inflow: '#3987e5',
  outflow: '#d95926',
  primary: '#3987e5',
} as const;

/** Blue sequential ramp (dark mode: low values recede toward the surface, high values brighten). */
export const SEQ_BLUE = ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6', '#cde2fb'] as const;

/** Map a normalised value in [0, 1] to the sequential ramp. */
export function seqColor(t: number): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  return SEQ_BLUE[Math.min(SEQ_BLUE.length - 1, Math.floor(x * SEQ_BLUE.length))];
}

/** Ink colour that stays readable on top of a given ramp step. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#0b1220' : INK.primary;
}

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Shared ECharts chrome: recessive hairline axes, ink-coloured text, navy tooltip. */
export const CHART_TEXT = { color: INK.secondary, fontFamily: 'inherit', fontSize: 12 };

export const TOOLTIP_BASE = {
  backgroundColor: '#0d1628',
  borderColor: SURFACE.axis,
  borderWidth: 1,
  padding: [8, 10] as [number, number],
  textStyle: { color: INK.primary, fontSize: 12 },
  extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,.35); border-radius: 8px;',
  confine: true,
};

export const AXIS_BASE = {
  axisLine: { lineStyle: { color: SURFACE.axis, width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: INK.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: SURFACE.grid, width: 1, type: 'solid' as const } },
};
