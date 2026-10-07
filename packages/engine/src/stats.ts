export const DAY = 86400;
export const HOUR = 3600;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Modified z-scores (Iglewicz & Hoaglin): 0.6745·(x − median)/MAD.
 * When MAD is 0 (over half the sample identical) fall back to the mean absolute deviation.
 */
export function robustZScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const m = median(values);
  const d = mad(values);
  if (d > 0) return values.map((v) => (0.6745 * (v - m)) / d);
  const meanAbs = values.reduce((acc, v) => acc + Math.abs(v - m), 0) / values.length;
  if (meanAbs > 0) return values.map((v) => (v - m) / (1.253314 * meanAbs));
  return values.map(() => 0);
}

export function utcDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Transaction counts per UTC day from the first to the last timestamp (zero-filled). */
export function dailyCounts(timestamps: number[], maxDays = 365): { date: string; count: number }[] {
  if (timestamps.length === 0) return [];
  const days = timestamps.map((t) => Math.floor(t / DAY));
  const last = Math.max(...days);
  const first = Math.max(Math.min(...days), last - maxDays + 1);
  const counts = new Array<number>(last - first + 1).fill(0);
  for (const d of days) if (d >= first) counts[d - first]++;
  return counts.map((count, i) => ({ date: utcDay((first + i) * DAY), count }));
}

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
