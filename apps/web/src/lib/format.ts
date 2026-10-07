/** Display formatting for the zh-TW UI. All wall-clock times are shown in Asia/Taipei. */

export const TZ = 'Asia/Taipei';

/**
 * API timestamps are documented as unix seconds, but accept milliseconds too:
 * anything below 1e12 is treated as seconds (1e12 ms ≈ 2001-09-09).
 */
export function toMs(ts: number): number {
  return Math.abs(ts) < 1e12 ? ts * 1000 : ts;
}

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parts(ts: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(new Date(toMs(ts)))) out[p.type] = p.value;
  return out;
}

/** `2026-10-07 22:19` (Asia/Taipei). */
export function fmtDateTime(ts: number | null | undefined, withSeconds = false): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—';
  const p = parts(ts);
  const time = withSeconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${p.year}-${p.month}-${p.day} ${time}`;
}

/** `2026-10-07` (Asia/Taipei). */
export function fmtDate(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—';
  const p = parts(ts);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `22:19` (Asia/Taipei). */
export function fmtClock(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—';
  const p = parts(ts);
  return `${p.hour}:${p.minute}`;
}

/** Relative time in zh-TW: 剛剛 / 5 分鐘前 / 3 小時前 / 2 天前, else the date. */
export function fmtRelative(ts: number | null | undefined, now: number = Date.now()): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—';
  const diff = Math.round((now - toMs(ts)) / 1000);
  if (diff < 45) return '剛剛';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} 分鐘前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 小時前`;
  if (diff < 30 * 86400) return `${Math.round(diff / 86400)} 天前`;
  return fmtDate(ts);
}

/** Thousands-separated integer. */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Compact USD for axes and tiles: US$950, US$12.9K, US$4.2M, US$1.1B. */
export function fmtUsdCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'US$—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}US$${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}US$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}US$${trim(abs / 1e3)}K`;
  if (abs >= 1) return `${sign}US$${Math.round(abs)}`;
  if (abs === 0) return 'US$0';
  return `${sign}US$${abs.toPrecision(2)}`;
}

function trim(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, '');
}

/** Milliseconds → `850 ms` / `2.4 秒`. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

export function fmtPct(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

/** Compact one-line representation of tool-call arguments. */
export function fmtArgs(args: Record<string, unknown>, maxLen = 48): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return '（無參數）';
  return entries
    .map(([k, v]) => {
      let s: string;
      if (typeof v === 'string') s = v;
      else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
      else s = JSON.stringify(v) ?? '';
      if (s.length > maxLen) s = `${s.slice(0, Math.floor(maxLen / 2))}…${s.slice(-Math.floor(maxLen / 4))}`;
      return `${k}=${s}`;
    })
    .join(', ');
}

/** `20261007` in Asia/Taipei, for filenames. */
export function fileStamp(tsMs: number = Date.now()): string {
  const p = parts(tsMs);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}
