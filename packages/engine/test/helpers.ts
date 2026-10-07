import { analyze, type AnalyzeInput } from '../src/analyze';
import { SanctionsIndex } from '../src/sanctions';
import { DAY } from '../src/stats';
import type { AddressProfile, Chain, Direction, NormTx } from '../src/types';

export const T0 = 1_780_000_000;
export const SUBJECT = '0x5000000000000000000000000000000000000005';
export const RONIN = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';
export const TORNADO_ROUTER = '0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b';
export const STARGATE = '0x8731d54E9D02c286767d56ac03e8037C07e01e98';
export const ACROSS = '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5';
export const BINANCE = '0x28C6c06298d514Db089934071355E5743bf21d60';

export const sanctions = SanctionsIndex.fromSnapshot();

export function addr(n: number): string {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

let seq = 0;
export function tx(
  p: Partial<NormTx> & { direction: Direction; counterparty: string },
  subject = SUBJECT,
): NormTx {
  seq++;
  const from = p.direction === 'in' ? p.counterparty : subject;
  const to = p.direction === 'in' ? subject : p.counterparty;
  return {
    chain: 'eth',
    hash: `0x${seq.toString(16).padStart(64, '0')}`,
    ts: T0 + seq * 60,
    from,
    to,
    asset: { symbol: 'ETH', decimals: 18 },
    amount: 1,
    usd: 2500,
    kind: 'native',
    status: 'ok',
    ...p,
  };
}

export function profile(p: Partial<AddressProfile> = {}, chain: Chain = 'eth'): AddressProfile {
  return {
    chain,
    address: SUBJECT,
    nativeSymbol: chain === 'btc' ? 'BTC' : chain === 'tron' ? 'TRX' : chain === 'bsc' ? 'BNB' : 'ETH',
    labels: [],
    firstSeen: T0 - 365 * DAY,
    ...p,
  };
}

export function run(txs: NormTx[], opts: Partial<AnalyzeInput> = {}) {
  const last = txs.reduce((m, t) => Math.max(m, t.ts), T0);
  return analyze({
    profile: profile(),
    txs,
    sanctions,
    now: last + DAY,
    ...opts,
  });
}

export function hit(result: ReturnType<typeof run>, id: string) {
  return result.hits.find((h) => h.id === id);
}
