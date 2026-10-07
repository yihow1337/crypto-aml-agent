import { describe, expect, it } from 'vitest';
import { addressUrl, baseTxHash, txUrl } from './explorer';

const H = 'ab'.repeat(32);

describe('block explorer links', () => {
  it('builds per-chain transaction URLs', () => {
    expect(txUrl('eth', `0x${H}`)).toBe(`https://etherscan.io/tx/0x${H}`);
    expect(txUrl('bsc', `0x${H}`)).toBe(`https://bscscan.com/tx/0x${H}`);
    expect(txUrl('tron', H)).toBe(`https://tronscan.org/#/transaction/${H}`);
    expect(txUrl('btc', H)).toBe(`https://mempool.space/tx/${H}`);
  });

  it('builds per-chain address URLs', () => {
    expect(addressUrl('eth', '0x098B716B8Aaf21512996dC57EB0615e2383E2f96')).toBe(
      'https://etherscan.io/address/0x098B716B8Aaf21512996dC57EB0615e2383E2f96',
    );
    expect(addressUrl('tron', 'TA3rH2A7iHnm6pKH8gr9cK1EZnShnmZdFg')).toBe(
      'https://tronscan.org/#/address/TA3rH2A7iHnm6pKH8gr9cK1EZnShnmZdFg',
    );
    expect(addressUrl('btc', 'bc1qxyz')).toBe('https://mempool.space/address/bc1qxyz');
  });

  it('strips log-index suffixes from hashes', () => {
    expect(baseTxHash('0xabc:3')).toBe('0xabc');
    expect(txUrl('eth', `0x${H}#12`)).toBe(`https://etherscan.io/tx/0x${H}`);
    expect(txUrl('eth', `0x${H}-7`)).toBe(`https://etherscan.io/tx/0x${H}`);
  });

  it('refuses unsafe or malformed values', () => {
    expect(txUrl('eth', 'javascript:alert(1)')).toBeNull();
    expect(txUrl('eth', '0xabc')).toBeNull();
    expect(addressUrl('eth', '0x12/../evil')).toBeNull();
    expect(addressUrl('eth', '')).toBeNull();
  });
});
