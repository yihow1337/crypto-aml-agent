import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { bech32, bech32m, createBase58check } from '@scure/base';
import type { Chain } from './types';

const b58check = createBase58check(sha256);

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC_BASE58_RE = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BTC_BECH32_RE = /^(bc1)[02-9ac-hj-np-z]{8,87}$/i;

export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

function isValidEvm(address: string): boolean {
  if (!EVM_RE.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}

function isValidTron(address: string): boolean {
  if (!TRON_RE.test(address)) return false;
  try {
    const bytes = b58check.decode(address);
    return bytes.length === 21 && bytes[0] === 0x41;
  } catch {
    return false;
  }
}

function isValidBtc(address: string): boolean {
  if (BTC_BASE58_RE.test(address)) {
    try {
      const bytes = b58check.decode(address);
      return bytes.length === 21 && (bytes[0] === 0x00 || bytes[0] === 0x05);
    } catch {
      return false;
    }
  }
  if (BTC_BECH32_RE.test(address)) {
    const lower = address.toLowerCase();
    try {
      const { prefix, words } = bech32.decode(lower as `${string}1${string}`);
      if (prefix === 'bc' && words[0] === 0) return true;
    } catch {
      /* fall through to bech32m */
    }
    try {
      const { prefix, words } = bech32m.decode(lower as `${string}1${string}`);
      return prefix === 'bc' && words[0] >= 1 && words[0] <= 16;
    } catch {
      return false;
    }
  }
  return false;
}

export function isValidAddress(chain: Chain, address: string): boolean {
  const a = address.trim();
  switch (chain) {
    case 'eth':
    case 'bsc':
      return isValidEvm(a);
    case 'tron':
      return isValidTron(a);
    case 'btc':
      return isValidBtc(a);
  }
}

/** Candidate chains for an address string (EVM addresses are ambiguous between ETH and BSC). */
export function detectChains(input: string): Chain[] {
  const a = input.trim();
  if (isValidEvm(a)) return ['eth', 'bsc'];
  if (isValidTron(a)) return ['tron'];
  if (isValidBtc(a)) return ['btc'];
  return [];
}

export function isEvm(chain: Chain): boolean {
  return chain === 'eth' || chain === 'bsc';
}

export function normalizeAddress(chain: Chain, address: string): string {
  const a = address.trim();
  if (isEvm(chain)) return a.toLowerCase();
  if (chain === 'btc' && /^bc1/i.test(a)) return a.toLowerCase();
  return a;
}

export function sameAddress(chain: Chain, a: string, b: string): boolean {
  return normalizeAddress(chain, a) === normalizeAddress(chain, b);
}

/** TronGrid native transactions use 41-prefixed hex; convert to the T… base58check form. */
export function tronHexToBase58(value: string): string {
  if (!value) return value;
  if (value.startsWith('T')) return value;
  const hex = value.replace(/^0x/, '');
  const full = hex.length === 40 ? `41${hex}` : hex;
  return b58check.encode(hexToBytes(full));
}

export function tronBase58ToHex(address: string): string {
  return bytesToHex(b58check.decode(address));
}

function addressBody(chain: Chain, address: string): string {
  const n = normalizeAddress(chain, address);
  if (isEvm(chain)) return n.slice(2);
  if (chain === 'tron') return n.slice(1);
  return n;
}

/**
 * Address-poisoning heuristic: two different addresses that share the first and last
 * `n` characters (what wallets typically display) are treated as lookalikes.
 */
export function isLookalike(chain: Chain, a: string, b: string, n = 4): boolean {
  if (!a || !b || sameAddress(chain, a, b)) return false;
  const x = addressBody(chain, a);
  const y = addressBody(chain, b);
  if (x.length < n * 2 || y.length < n * 2) return false;
  return x.slice(0, n) === y.slice(0, n) && x.slice(-n) === y.slice(-n);
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (!address || address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
