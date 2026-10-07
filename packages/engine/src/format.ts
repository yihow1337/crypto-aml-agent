export function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return 'US$—';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `US$${n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
}

export function fmtAmount(n: number, symbol: string): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })} ${symbol}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} 分鐘`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小時`;
  return `${Math.round(seconds / 86400)} 天`;
}

const FORBIDDEN = new Set(['<', '>', '`', '{', '}', '[', ']', '\\']);

/** Strip control characters / markup and truncate untrusted on-chain strings (token names, tags). */
export function sanitizeText(value: unknown, max = 40): string {
  if (typeof value !== 'string') return '';
  let cleaned = '';
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    if (control || invisible || FORBIDDEN.has(ch)) continue;
    cleaned += ch;
  }
  cleaned = cleaned.trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
