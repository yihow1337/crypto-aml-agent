import type { Chain } from '@aml/engine';

export interface SampleAddress {
  chain: Chain;
  address: string;
  label: string;
  note: string;
}

/** Real, publicly known addresses for one-click demos. */
export const SAMPLE_ADDRESSES: SampleAddress[] = [
  {
    chain: 'eth',
    address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96',
    label: 'Ronin 駭客',
    note: 'OFAC 制裁（Lazarus 集團）',
  },
  {
    chain: 'eth',
    address: '0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b',
    label: 'Tornado Cash Router',
    note: '混幣器合約',
  },
  {
    chain: 'eth',
    address: '0x28C6c06298d514Db089934071355E5743bf21d60',
    label: 'Binance 14',
    note: '交易所熱錢包（減權對照）',
  },
  {
    chain: 'tron',
    address: 'TA3rH2A7iHnm6pKH8gr9cK1EZnShnmZdFg',
    label: 'TRON 制裁地址',
    note: 'OFAC 制裁',
  },
  {
    chain: 'btc',
    address: '123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX',
    label: 'BTC 制裁地址',
    note: 'OFAC 制裁',
  },
];
