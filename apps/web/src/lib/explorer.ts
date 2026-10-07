import type { Chain } from '@aml/engine';

const BASE: Record<Chain, { tx: (h: string) => string; address: (a: string) => string }> = {
  eth: {
    tx: (h) => `https://etherscan.io/tx/${h}`,
    address: (a) => `https://etherscan.io/address/${a}`,
  },
  bsc: {
    tx: (h) => `https://bscscan.com/tx/${h}`,
    address: (a) => `https://bscscan.com/address/${a}`,
  },
  tron: {
    tx: (h) => `https://tronscan.org/#/transaction/${h}`,
    address: (a) => `https://tronscan.org/#/address/${a}`,
  },
  btc: {
    tx: (h) => `https://mempool.space/tx/${h}`,
    address: (a) => `https://mempool.space/address/${a}`,
  },
};

const SAFE = /^[0-9A-Za-z]+$/;
/** 32-byte transaction id, optionally 0x-prefixed (EVM). */
const TX_HASH = /^(0x)?[0-9a-fA-F]{64}$/;

/** Strip log-index style suffixes (`0xabc…:3`, `0xabc…#3`, `0xabc…-3`) that some adapters append. */
export function baseTxHash(hash: string): string {
  return hash.trim().split(/[:#-]/)[0];
}

export function txUrl(chain: Chain, hash: string): string | null {
  const h = baseTxHash(hash);
  if (!TX_HASH.test(h)) return null;
  return BASE[chain].tx(h);
}

export function addressUrl(chain: Chain, address: string): string | null {
  const a = address.trim();
  if (!a || !SAFE.test(a)) return null;
  return BASE[chain].address(a);
}

export const EXPLORER_NAME: Record<Chain, string> = {
  eth: 'Etherscan',
  bsc: 'BscScan',
  tron: 'Tronscan',
  btc: 'mempool.space',
};
