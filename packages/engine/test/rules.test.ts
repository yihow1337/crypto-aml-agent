import { describe, expect, it } from 'vitest';
import { DAY, HOUR } from '../src/stats';
import type { NormTx } from '../src/types';
import {
  ACROSS,
  addr,
  BINANCE,
  hit,
  profile,
  RONIN,
  run,
  STARGATE,
  SUBJECT,
  T0,
  TORNADO_ROUTER,
  tx,
} from './helpers';

const BTC_SUBJECT = 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h';

function btcTx(p: Partial<NormTx> & { direction: 'in' | 'out' }): NormTx {
  return tx({ chain: 'btc', asset: { symbol: 'BTC', decimals: 8 }, counterparty: 'bc1qother', ...p }, BTC_SUBJECT);
}

describe('R01 subject sanctioned', () => {
  it('scores 100 / critical when the subject is on the OFAC list', () => {
    const r = run([tx({ direction: 'in', counterparty: addr(1) })], {
      profile: profile({ address: RONIN }),
    });
    expect(hit(r, 'R01')).toBeDefined();
    expect(r.score).toBe(100);
    expect(r.level).toBe('critical');
  });
});

describe('R02 direct sanctions exposure', () => {
  it('flags an outgoing transfer to a sanctioned address with intensity 1 and floor 80', () => {
    const r = run([tx({ direction: 'out', counterparty: RONIN })]);
    const h = hit(r, 'R02');
    expect(h?.intensity).toBe(1);
    expect(h?.evidence[0].address?.toLowerCase()).toBe(RONIN.toLowerCase());
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.level).toBe('critical');
  });
  it('uses intensity 0.9 when funds only came in from the sanctioned address', () => {
    const r = run([tx({ direction: 'in', counterparty: RONIN })]);
    expect(hit(r, 'R02')?.intensity).toBe(0.9);
  });
});

describe('R03 indirect exposure', () => {
  it('fires only when tracing reports exposed counterparties', () => {
    const cp = addr(7);
    const txs = [tx({ direction: 'in', counterparty: cp, usd: 50_000 })];
    expect(hit(run(txs), 'R03')).toBeUndefined();
    const r = run(txs, { exposure: { [cp]: { sanctioned: true, mixer: false, via: RONIN } } });
    expect(hit(r, 'R03')?.severity).toBe('high');
  });
});

describe('R04 mixer interaction', () => {
  it('flags a single Tornado deposit and applies the High floor', () => {
    const r = run([tx({ direction: 'out', counterparty: TORNADO_ROUTER, amount: 10 })]);
    expect(hit(r, 'R04')).toBeDefined();
    expect(r.score).toBeGreaterThanOrEqual(50);
  });
  it('gives repeated deposits a higher intensity than a single withdrawal', () => {
    const deposits = run([1, 2, 3].map(() => tx({ direction: 'out', counterparty: TORNADO_ROUTER })));
    const withdrawal = run([tx({ direction: 'in', counterparty: TORNADO_ROUTER })]);
    expect(hit(deposits, 'R04')!.intensity).toBeGreaterThan(hit(withdrawal, 'R04')!.intensity);
  });
});

describe('R05 CoinJoin', () => {
  it('flags a transaction with many equal-value outputs', () => {
    const cj = btcTx({
      direction: 'out',
      amount: 0.05,
      usd: 3000,
      btc: {
        nIn: 6,
        nOut: 7,
        inputAddrs: [BTC_SUBJECT, 'a', 'b', 'c', 'd', 'e'],
        outputAddrs: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'],
        outValues: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.0012],
        subjectNet: -0.05,
      },
    });
    const r = run([cj], { profile: profile({ address: BTC_SUBJECT }, 'btc') });
    expect(hit(r, 'R05')).toBeDefined();
  });
  it('ignores an ordinary 1-in-2-out payment', () => {
    const pay = btcTx({
      direction: 'out',
      btc: { nIn: 1, nOut: 2, inputAddrs: [BTC_SUBJECT], outputAddrs: ['x', BTC_SUBJECT], outValues: [0.1, 0.5], subjectNet: -0.1 },
    });
    expect(hit(run([pay], { profile: profile({ address: BTC_SUBJECT }, 'btc') }), 'R05')).toBeUndefined();
  });
});

describe('R06 structuring', () => {
  it('flags three just-below-US$10k transfers within 7 days', () => {
    const r = run([0, 1, 2].map((d) => tx({ direction: 'out', counterparty: addr(10 + d), usd: 9_500, ts: T0 + d * DAY })));
    expect(hit(r, 'R06')).toBeDefined();
  });
  it('does not flag the same amounts spread over a month', () => {
    const r = run([0, 12, 25].map((d) => tx({ direction: 'out', counterparty: addr(10 + d), usd: 9_500, ts: T0 + d * DAY })));
    expect(hit(r, 'R06')).toBeUndefined();
  });
  it('flags smurfing: many small senders aggregating above the threshold in 24h', () => {
    const txs = Array.from({ length: 12 }, (_, i) =>
      tx({ direction: 'in', counterparty: addr(100 + i), usd: 900, ts: T0 + i * HOUR }),
    );
    expect(hit(run(txs), 'R06')).toBeDefined();
  });
});

describe('R07 rapid pass-through', () => {
  function cycle(start: number, outDelay: number): NormTx[] {
    return [
      tx({ direction: 'in', counterparty: addr(200 + start), usd: 20_000, amount: 8, ts: T0 + start * DAY }),
      tx({ direction: 'out', counterparty: addr(300 + start), usd: 19_500, amount: 7.8, ts: T0 + start * DAY + outDelay }),
    ];
  }
  it('flags three inflows forwarded within an hour', () => {
    const r = run([...cycle(0, 1800), ...cycle(1, 1200), ...cycle(2, 600)]);
    expect(hit(r, 'R07')?.severity).toBe('high');
  });
  it('does not flag outflows that happen days later', () => {
    const r = run([...cycle(0, 3 * DAY), ...cycle(10, 3 * DAY), ...cycle(20, 3 * DAY)]);
    expect(hit(r, 'R07')).toBeUndefined();
  });
});

describe('R08 peel chain', () => {
  function peel(i: number): NormTx {
    return btcTx({
      direction: 'out',
      amount: 0.3,
      usd: 18_000,
      ts: T0 + i * HOUR,
      btc: {
        nIn: 1,
        nOut: 2,
        inputAddrs: [BTC_SUBJECT],
        outputAddrs: [`bc1qpeel${i}`, BTC_SUBJECT],
        outValues: [0.3, 10 - i],
        subjectNet: -0.3,
      },
    });
  }
  it('flags repeated small peels with change returning to the subject', () => {
    const r = run([peel(0), peel(1), peel(2)], { profile: profile({ address: BTC_SUBJECT }, 'btc') });
    expect(hit(r, 'R08')).toBeDefined();
  });
  it('flags a traced multi-hop peel chain', () => {
    const r = run([peel(0)], { profile: profile({ address: BTC_SUBJECT }, 'btc'), peelHops: 4 });
    expect(hit(r, 'R08')).toBeDefined();
  });
});

describe('R09 fan-in / fan-out', () => {
  it('flags 25 distinct senders within 24h as fan-in', () => {
    const txs = Array.from({ length: 25 }, (_, i) =>
      tx({ direction: 'in', counterparty: addr(400 + i), usd: 50, ts: T0 + i * 1800 }),
    );
    expect(hit(run(txs), 'R09A')).toBeDefined();
    expect(hit(run(txs), 'R09B')).toBeUndefined();
  });
  it('flags 25 distinct receivers within 24h as fan-out', () => {
    const txs = Array.from({ length: 25 }, (_, i) =>
      tx({ direction: 'out', counterparty: addr(500 + i), usd: 50, ts: T0 + i * 1800 }),
    );
    expect(hit(run(txs), 'R09B')).toBeDefined();
  });
});

describe('R10 velocity burst', () => {
  it('flags a day with far more transactions than the baseline', () => {
    const baseline = Array.from({ length: 30 }, (_, d) =>
      tx({ direction: 'in', counterparty: addr(600), usd: 10, ts: T0 + d * DAY }),
    );
    const burst = Array.from({ length: 15 }, (_, i) =>
      tx({ direction: 'out', counterparty: addr(600), usd: 10, ts: T0 + 31 * DAY + i * 60 }),
    );
    expect(hit(run([...baseline, ...burst]), 'R10')).toBeDefined();
  });
  it('does not flag a steady pattern', () => {
    const steady = Array.from({ length: 30 }, (_, d) =>
      tx({ direction: 'in', counterparty: addr(600), usd: 10, ts: T0 + d * DAY }),
    );
    expect(hit(run(steady), 'R10')).toBeUndefined();
  });
});

describe('R11 round amounts', () => {
  it('flags mostly round amounts', () => {
    const txs = [10, 20, 5, 100, 50, 30].map((amount) => tx({ direction: 'out', counterparty: addr(700), amount }));
    expect(hit(run(txs), 'R11')).toBeDefined();
  });
  it('ignores irregular amounts', () => {
    const txs = [1.234, 2.71, 0.0731, 3.14159, 9.87, 4.4441].map((amount) =>
      tx({ direction: 'out', counterparty: addr(700), amount }),
    );
    expect(hit(run(txs), 'R11')).toBeUndefined();
  });
});

describe('R12 dormant reactivation', () => {
  it('flags large movement right after a 200-day silence', () => {
    const r = run([
      tx({ direction: 'in', counterparty: addr(800), usd: 1_000, ts: T0 }),
      tx({ direction: 'out', counterparty: addr(801), usd: 60_000, ts: T0 + 200 * DAY }),
    ]);
    expect(hit(r, 'R12')).toBeDefined();
  });
});

describe('R13 new address, high value', () => {
  const txs = () => [tx({ direction: 'in', counterparty: addr(900), usd: 150_000, ts: T0 })];
  it('flags a 10-day-old address moving US$150k as medium', () => {
    const r = run(txs(), { profile: profile({ firstSeen: T0 - 10 * DAY }), now: T0 + DAY });
    expect(hit(r, 'R13')?.severity).toBe('medium');
  });
  it('escalates to high above US$1M', () => {
    const big = [tx({ direction: 'in', counterparty: addr(900), usd: 1_500_000, ts: T0 })];
    const r = run(big, { profile: profile({ firstSeen: T0 - 10 * DAY }), now: T0 + DAY });
    expect(hit(r, 'R13')?.severity).toBe('high');
  });
  it('does not flag old addresses', () => {
    expect(hit(run(txs()), 'R13')).toBeUndefined();
  });
});

describe('R14 address poisoning', () => {
  const real = '0x1234567890abcdef1234567890abcdef12345678';
  const fake = '0x1234ffffffffffffffffffffffffffffffff5678';
  const base = () => [
    tx({ direction: 'out', counterparty: real, usd: 5_000, ts: T0 }),
    tx({ direction: 'in', counterparty: fake, usd: 0, amount: 0, ts: T0 + 600 }),
  ];
  it('R14A: flags a zero-value transfer from a lookalike of a real counterparty', () => {
    const r = run(base());
    expect(hit(r, 'R14A')?.evidence.some((e) => e.address === fake)).toBe(true);
    expect(hit(r, 'R14B')).toBeUndefined();
  });
  it('R14B: flags a later real payment to the lookalike as high severity', () => {
    const r = run([...base(), tx({ direction: 'out', counterparty: fake, usd: 5_000, ts: T0 + DAY })]);
    expect(hit(r, 'R14B')?.severity).toBe('high');
  });
  it('R14C: flags an address spraying zero-value transfers to many receivers', () => {
    const txs = Array.from({ length: 12 }, (_, i) =>
      tx({ direction: 'out', counterparty: addr(1000 + i), usd: 0, amount: 0, kind: 'token' }),
    );
    expect(hit(run(txs), 'R14C')).toBeDefined();
  });
});

describe('R15 / R17 labeled counterparties', () => {
  it('R15: flags transfers with a scam-labeled counterparty', () => {
    const cp = addr(1100);
    const r = run([tx({ direction: 'out', counterparty: cp })], {
      extraLabels: { [cp]: [{ name: 'Phish / Hack', category: 'scam', source: 'blockscout' }] },
    });
    expect(hit(r, 'R15')).toBeDefined();
  });
  it('R17: flags a high-risk service counterparty', () => {
    const cp = addr(1101);
    const r = run([tx({ direction: 'in', counterparty: cp })], {
      extraLabels: { [cp]: [{ name: 'Huione Guarantee', category: 'high_risk', source: 'scenario' }] },
    });
    expect(hit(r, 'R17')).toBeDefined();
  });
});

describe('R16 bridge hopping', () => {
  it('flags two bridge-in / bridge-out hops within 2 hours', () => {
    const txs = [0, 1].flatMap((d) => [
      tx({ direction: 'in', counterparty: STARGATE, usd: 30_000, ts: T0 + d * DAY }),
      tx({ direction: 'out', counterparty: ACROSS, usd: 29_000, ts: T0 + d * DAY + 1800 }),
    ]);
    expect(hit(run(txs), 'R16')).toBeDefined();
  });
});

describe('R18 statistical outlier', () => {
  it('flags one very large transfer among small ones', () => {
    const small = Array.from({ length: 20 }, (_, i) =>
      tx({ direction: 'in', counterparty: addr(1200 + i), usd: 80 + i * 3, ts: T0 + i * DAY }),
    );
    const big = tx({ direction: 'out', counterparty: addr(1300), usd: 50_000, ts: T0 + 21 * DAY });
    expect(hit(run([...small, big]), 'R18')?.evidence[0].txHash).toBe(big.hash);
  });
});

describe('scoring', () => {
  it('returns a low score with no hits', () => {
    const r = run([tx({ direction: 'in', counterparty: addr(1), usd: 123.45, amount: 0.04937 })]);
    expect(r.hits).toEqual([]);
    expect(r.level).toBe('low');
    expect(r.score).toBeLessThan(25);
  });
  it('never decreases when another rule fires', () => {
    const one = run([tx({ direction: 'out', counterparty: TORNADO_ROUTER })]);
    const two = run([
      tx({ direction: 'out', counterparty: TORNADO_ROUTER }),
      ...[0, 1, 2].map((d) => tx({ direction: 'out', counterparty: addr(10 + d), usd: 9_500, ts: T0 + d * DAY })),
    ]);
    expect(two.score).toBeGreaterThanOrEqual(one.score);
  });
  it('stays within 0..100', () => {
    const r = run([
      tx({ direction: 'out', counterparty: RONIN }),
      tx({ direction: 'out', counterparty: TORNADO_ROUTER }),
    ], { profile: profile({ address: RONIN }) });
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it('dampens behavioural rules for an exchange subject but not sanctions', () => {
    const cycles = [0, 1, 2].flatMap((d) => [
      tx({ direction: 'in', counterparty: addr(200 + d), usd: 20_000, amount: 8, ts: T0 + d * DAY }, BINANCE),
      tx({ direction: 'out', counterparty: addr(300 + d), usd: 19_900, amount: 7.9, ts: T0 + d * DAY + 600 }, BINANCE),
    ]);
    const r = run(cycles, { profile: profile({ address: BINANCE }) });
    const h = hit(r, 'R07');
    expect(h?.dampened).toBe(true);
    expect(h!.contribution).toBeCloseTo(h!.weight * h!.intensity * 0.3, 6);
    expect(r.score).toBeLessThan(50);
  });
  it('ignores failed transactions', () => {
    const r = run([tx({ direction: 'out', counterparty: RONIN, status: 'failed' })]);
    expect(hit(r, 'R02')).toBeUndefined();
  });
  it('produces a breakdown whose points sum to the rule score', () => {
    const r = run([
      tx({ direction: 'out', counterparty: TORNADO_ROUTER }),
      ...[0, 1, 2].map((d) => tx({ direction: 'out', counterparty: addr(10 + d), usd: 9_500, ts: T0 + d * DAY })),
    ]);
    const total = r.breakdown.reduce((s, b) => s + b.points, 0);
    expect(total).toBeCloseTo(r.sRules, 6);
  });
});

describe('analysis output', () => {
  it('summarises counterparties, graph and timeline', () => {
    const r = run([
      tx({ direction: 'in', counterparty: BINANCE, usd: 1_000 }),
      tx({ direction: 'out', counterparty: addr(5), usd: 400 }),
    ]);
    expect(r.counterparties[0].address.toLowerCase()).toBe(BINANCE.toLowerCase());
    expect(r.counterparties[0].labels[0].category).toBe('exchange');
    expect(r.graph.nodes.find((n) => n.category === 'subject')?.id).toBe(SUBJECT);
    expect(r.graph.edges.length).toBe(2);
    expect(r.timeline.length).toBe(1);
    expect(r.stats.inUsd).toBe(1_000);
    expect(r.stats.outUsd).toBe(400);
  });
});
