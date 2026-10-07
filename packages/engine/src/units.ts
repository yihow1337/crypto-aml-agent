/** Convert an integer string in base units (wei, sun, sats…) to a decimal number. */
export function rawToDecimal(raw: string | number | bigint, decimals: number): number {
  let value: bigint;
  try {
    value = typeof raw === 'bigint' ? raw : BigInt(typeof raw === 'number' ? Math.trunc(raw) : raw.trim() || 'x');
  } catch {
    return 0;
  }
  const negative = value < 0n;
  if (negative) value = -value;
  if (decimals <= 0) return Number(value) * (negative ? -1 : 1);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const result = Number(whole) + Number(frac) / Number(base);
  return negative ? -result : result;
}

/** Amounts people type by hand: one significant digit (5, 0.3, 20000) or whole thousands. */
export function isRoundAmount(amount: number): boolean {
  if (!(amount > 0) || !Number.isFinite(amount)) return false;
  if (amount >= 1000 && Math.abs(amount % 1000) < 1e-9) return true;
  const exponent = Math.floor(Math.log10(amount));
  const scaled = amount / 10 ** exponent;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}
