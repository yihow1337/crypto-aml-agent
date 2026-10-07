import { describe, expect, it } from 'vitest';
import { fileStamp, fmtArgs, fmtClock, fmtDate, fmtDateTime, fmtMs, fmtRelative, fmtUsdCompact, toMs } from './format';

describe('toMs', () => {
  it('treats small values as unix seconds and large ones as milliseconds', () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe('Asia/Taipei formatting', () => {
  it('formats unix seconds in UTC+8', () => {
    expect(fmtDateTime(0)).toBe('1970-01-01 08:00');
    expect(fmtDate(0)).toBe('1970-01-01');
    expect(fmtClock(0)).toBe('08:00');
  });

  it('crosses the date line correctly', () => {
    // 2026-10-07T16:30:00Z = 2026-10-08 00:30 in Taipei
    const ts = Date.UTC(2026, 9, 7, 16, 30) / 1000;
    expect(fmtDateTime(ts)).toBe('2026-10-08 00:30');
    expect(fmtDateTime(ts * 1000, true)).toBe('2026-10-08 00:30:00');
  });

  it('returns a dash for missing values', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
  });

  it('builds file stamps', () => {
    expect(fileStamp(Date.UTC(2026, 9, 7, 14, 5))).toBe('20261007-2205');
  });
});

describe('fmtRelative', () => {
  const now = Date.UTC(2026, 9, 7, 12, 0);
  it('produces zh-TW relative strings', () => {
    expect(fmtRelative(now / 1000 - 10, now)).toBe('剛剛');
    expect(fmtRelative(now / 1000 - 5 * 60, now)).toBe('5 分鐘前');
    expect(fmtRelative(now / 1000 - 3 * 3600, now)).toBe('3 小時前');
    expect(fmtRelative(now / 1000 - 2 * 86400, now)).toBe('2 天前');
    expect(fmtRelative(now / 1000 - 60 * 86400, now)).toBe('2026-08-08');
  });
  it('accepts millisecond timestamps', () => {
    expect(fmtRelative(now - 5 * 60_000, now)).toBe('5 分鐘前');
  });
});

describe('number formatting', () => {
  it('compacts USD', () => {
    expect(fmtUsdCompact(950)).toBe('US$950');
    expect(fmtUsdCompact(12_900)).toBe('US$12.9K');
    expect(fmtUsdCompact(4_200_000)).toBe('US$4.2M');
    expect(fmtUsdCompact(-1_000)).toBe('-US$1K');
    expect(fmtUsdCompact(0)).toBe('US$0');
    expect(fmtUsdCompact(undefined)).toBe('US$—');
  });
  it('formats durations in ms', () => {
    expect(fmtMs(850)).toBe('850 ms');
    expect(fmtMs(2400)).toBe('2.4 秒');
  });
  it('renders tool arguments compactly', () => {
    expect(fmtArgs({ chain: 'eth', limit: 200 })).toBe('chain=eth, limit=200');
    expect(fmtArgs({})).toBe('（無參數）');
    expect(fmtArgs({ address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96' }, 20)).toBe('address=0x098B716B…E2f96');
  });
});
