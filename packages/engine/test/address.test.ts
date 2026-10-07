import { describe, expect, it } from 'vitest';
import {
  detectChains,
  isLookalike,
  isValidAddress,
  normalizeAddress,
  sameAddress,
  shortAddress,
  toChecksumAddress,
  tronBase58ToHex,
  tronHexToBase58,
} from '../src/address';

describe('detectChains', () => {
  it('returns eth and bsc for a 0x address', () => {
    expect(detectChains('0x28C6c06298d514Db089934071355E5743bf21d60')).toEqual(['eth', 'bsc']);
  });
  it('returns tron for a valid T address', () => {
    expect(detectChains('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toEqual(['tron']);
  });
  it('returns btc for legacy, p2sh and bech32 addresses', () => {
    expect(detectChains('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toEqual(['btc']);
    expect(detectChains('123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX')).toEqual(['btc']);
    expect(detectChains('bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h')).toEqual(['btc']);
  });
  it('trims whitespace', () => {
    expect(detectChains('  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t \n')).toEqual(['tron']);
  });
  it('returns [] for garbage', () => {
    expect(detectChains('hello')).toEqual([]);
    expect(detectChains('0x1234')).toEqual([]);
    expect(detectChains('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6T')).toEqual([]);
  });
});

describe('isValidAddress', () => {
  it('validates EVM addresses including EIP-55 checksum when mixed case', () => {
    expect(isValidAddress('eth', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true);
    expect(isValidAddress('eth', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true);
    expect(isValidAddress('eth', '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
  });
  it('rejects a TRON address with a bad checksum', () => {
    expect(isValidAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
    expect(isValidAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u')).toBe(false);
  });
  it('validates bech32 and rejects wrong checksum', () => {
    expect(isValidAddress('btc', 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h')).toBe(true);
    expect(isValidAddress('btc', 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3j')).toBe(false);
  });
});

describe('TRON hex <-> base58', () => {
  it('converts the USDT contract hex to base58', () => {
    expect(tronHexToBase58('41a614f803b6fd780986a42c78ec9c7f77e6ded13c')).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
  });
  it('round-trips base58 -> hex', () => {
    expect(tronBase58ToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    );
  });
  it('passes through values already in base58', () => {
    expect(tronHexToBase58('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
  });
});

describe('normalizeAddress / sameAddress', () => {
  it('lowercases EVM addresses only', () => {
    expect(normalizeAddress('eth', '0xABCDEF0000000000000000000000000000000001')).toBe(
      '0xabcdef0000000000000000000000000000000001',
    );
    expect(normalizeAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
  });
  it('compares EVM case-insensitively', () => {
    expect(
      sameAddress(
        'bsc',
        '0x28C6c06298d514Db089934071355E5743bf21d60',
        '0x28c6c06298d514db089934071355e5743bf21d60',
      ),
    ).toBe(true);
  });
});

describe('toChecksumAddress', () => {
  it('produces the EIP-55 test vector', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
  });
});

describe('isLookalike', () => {
  const real = '0x1234567890abcdef1234567890abcdef12345678';
  it('flags same first-4 / last-4 but different middle', () => {
    expect(isLookalike('eth', real, '0x1234ffffffffffffffffffffffffffffffff5678')).toBe(true);
  });
  it('does not flag identical addresses', () => {
    expect(isLookalike('eth', real, real.toUpperCase().replace('0X', '0x'))).toBe(false);
  });
  it('does not flag unrelated addresses', () => {
    expect(isLookalike('eth', real, '0xabcdffffffffffffffffffffffffffffffff5678')).toBe(false);
  });
  it('works for TRON (skipping the T prefix)', () => {
    expect(
      isLookalike('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TR7NHzzzzzzzzzzzzzzzzzzzzzzzzLj6t'),
    ).toBe(true);
  });
});

describe('shortAddress', () => {
  it('abbreviates long addresses', () => {
    expect(shortAddress('0x28C6c06298d514Db089934071355E5743bf21d60')).toBe('0x28C6…1d60');
  });
});
