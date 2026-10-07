import type { AnalyzeInput } from '../analyze';
import type { AddressLabel, Chain, CounterpartyExposure, NormTx, RiskLevel } from '../types';
import { acctTx, btcTx, DAY, Gen, HOUR, MIN, profileFor, SCENARIO_NOW, type Utxo } from './gen';

export interface ScenarioMeta {
  id: string;
  title: string;
  chain: Chain;
  summary: string;
  typologies: string[];
  expected: { levels: RiskLevel[]; rules: string[] };
}

export type ScenarioData = Omit<AnalyzeInput, 'sanctions'> & { meta: ScenarioMeta };

const SYNTHETIC_NOTE = '本情境為合成資料，用於展示偵測邏輯；地址與交易雜湊皆為隨機產生，非真實鏈上紀錄。';

// Real, well-known addresses referenced by the scenarios.
const RONIN_EXPLOITER = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';
const TORNADO_100_ETH = '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291';
const TORNADO_10_ETH = '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF';
const BINANCE_14 = '0x28C6c06298d514Db089934071355E5743bf21d60';
const COINBASE_10 = '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43';
const KRAKEN = '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2';
const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const FAKE_USDT_TRON = 'TQgktYKdVbcJBWkLTN1V4YGXNeYfSaLyJA';
const BSC_USD = '0x55d398326f99059fF775485246999027B3197955';
const STARGATE_BSC = '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8';
const WORMHOLE_BSC = '0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7';
const CBRIDGE_BSC = '0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF';
const BINANCE_BTC_COLD = '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo';

function label(name: string, category: AddressLabel['category']): AddressLabel[] {
  return [{ name, category, source: 'scenario' }];
}

type Builder = () => Omit<ScenarioData, 'meta'>;

const SCENARIO_DEFS: { meta: ScenarioMeta; build: Builder }[] = [
  {
    meta: {
      id: 's1',
      title: '制裁地址資金流入後轉入 Tornado Cash',
      chain: 'eth',
      summary: '新地址收到 Ronin 跨鏈橋駭客（OFAC 制裁、Lazarus 集團）資金後，數十分鐘內分批存入 Tornado Cash。',
      typologies: ['制裁', '混幣', '分層'],
      expected: { levels: ['critical'], rules: ['R02', 'R03', 'R04'] },
    },
    build() {
      const g = new Gen('s1');
      const chain = 'eth';
      const S = g.address(chain);
      const funder = g.address(chain);
      const t0 = SCENARIO_NOW - 20 * DAY;
      const txs: NormTx[] = [
        acctTx(g, chain, S, { dir: 'in', cp: funder, amount: 0.3512, ts: t0 }),
        acctTx(g, chain, S, { dir: 'in', cp: RONIN_EXPLOITER, amount: 120, ts: t0 + HOUR }),
        acctTx(g, chain, S, { dir: 'out', cp: TORNADO_100_ETH, amount: 100, ts: t0 + HOUR + 22 * MIN }),
        acctTx(g, chain, S, { dir: 'in', cp: RONIN_EXPLOITER, amount: 150, ts: t0 + DAY }),
        acctTx(g, chain, S, { dir: 'out', cp: TORNADO_100_ETH, amount: 100, ts: t0 + DAY + 14 * MIN }),
        ...[0, 1, 2, 3, 4].map((i) =>
          acctTx(g, chain, S, { dir: 'out', cp: TORNADO_10_ETH, amount: 10, ts: t0 + DAY + (30 + i * 4) * MIN }),
        ),
        acctTx(g, chain, S, { dir: 'in', cp: RONIN_EXPLOITER, amount: 95, ts: t0 + 2 * DAY }),
        acctTx(g, chain, S, { dir: 'out', cp: TORNADO_100_ETH, amount: 100, ts: t0 + 2 * DAY + 31 * MIN }),
        acctTx(g, chain, S, { dir: 'out', cp: funder, amount: 0.1187, ts: t0 + 3 * DAY }),
      ];
      return {
        profile: profileFor(chain, S, txs),
        txs,
        exposure: { [funder]: { sanctioned: true, mixer: false, via: RONIN_EXPLOITER, note: '同一攻擊者的燃料費錢包' } },
        now: SCENARIO_NOW,
        notes: [SYNTHETIC_NOTE],
      };
    },
  },
  {
    meta: {
      id: 's2',
      title: 'Tornado Cash 提領後快速過帳',
      chain: 'eth',
      summary: '地址多次自 Tornado Cash 10 ETH 池提領，每次在 1 小時內轉往新地址或交易所，留存趨近於零。',
      typologies: ['混幣', '分層', '過水帳戶'],
      expected: { levels: ['high', 'critical'], rules: ['R04', 'R07'] },
    },
    build() {
      const g = new Gen('s2');
      const chain = 'eth';
      const S = g.address(chain);
      const t0 = SCENARIO_NOW - 12 * DAY;
      const txs: NormTx[] = [];
      for (let i = 0; i < 4; i++) {
        const ts = t0 + i * 2 * DAY + g.int(0, 6) * HOUR;
        txs.push(acctTx(g, chain, S, { dir: 'in', cp: TORNADO_10_ETH, amount: 9.9, ts }));
        const cp = i % 2 === 1 ? BINANCE_14 : g.address(chain);
        txs.push(acctTx(g, chain, S, { dir: 'out', cp, amount: g.amount(9.84, 9.88), ts: ts + g.int(12, 45) * MIN }));
      }
      return { profile: profileFor(chain, S, txs), txs, now: SCENARIO_NOW, notes: [SYNTHETIC_NOTE] };
    },
  },
  {
    meta: {
      id: 's3',
      title: 'USDT 結構化拆分 + 高風險擔保平台',
      chain: 'tron',
      summary: '多個來源以略低於 US$10,000 的 USDT 分次匯入，彙整後轉往被標記為高風險的擔保平台地址。',
      typologies: ['結構化', '高風險服務'],
      expected: { levels: ['high'], rules: ['R06', 'R17'] },
    },
    build() {
      const g = new Gen('s3');
      const chain = 'tron';
      const S = g.address(chain);
      const guarantee = g.address(chain);
      const senders = Array.from({ length: 9 }, () => g.address(chain));
      const t0 = SCENARIO_NOW - 15 * DAY;
      const usdt = { symbol: 'USDT', contract: USDT_TRON, decimals: 6 };
      const txs: NormTx[] = [acctTx(g, chain, S, { dir: 'in', cp: g.address(chain), amount: 152.3, ts: t0 - DAY })];
      for (let i = 0; i < 14; i++) {
        const ts = t0 + Math.floor(i * 0.7 * DAY) + g.int(0, 8) * HOUR;
        txs.push(acctTx(g, chain, S, { ...usdt, dir: 'in', cp: senders[i % senders.length], amount: g.amount(9050, 9950, 2), ts }));
      }
      for (let i = 0; i < 8; i++) {
        const ts = t0 + Math.floor(i * 1.25 * DAY) + 20 * HOUR;
        txs.push(acctTx(g, chain, S, { ...usdt, dir: 'out', cp: guarantee, amount: g.amount(14_200, 16_100, 2), ts }));
      }
      return {
        profile: profileFor(chain, S, txs),
        txs,
        extraLabels: { [guarantee]: label('擔保交易平台（模擬，FinCEN 311 類型）', 'high_risk') },
        now: SCENARIO_NOW,
        notes: [SYNTHETIC_NOTE],
      };
    },
  },
  {
    meta: {
      id: 's4',
      title: '駭客贓款剝離鏈 (Peel Chain)',
      chain: 'btc',
      summary: '收到交易所駭客 50 BTC 後，反覆以小額支付至不同交易所充值地址、大額找零回原地址的方式逐步剝離。',
      typologies: ['剝離鏈', '駭客贓款'],
      expected: { levels: ['high', 'critical'], rules: ['R08', 'R15'] },
    },
    build() {
      const g = new Gen('s4');
      const S = g.address('btc');
      const hacker = g.address('btc');
      const t0 = SCENARIO_NOW - 9 * DAY;
      const txs: NormTx[] = [btcTx(g, S, t0, [{ addr: hacker, value: 50.0004 }], [{ addr: S, value: 50 }])];
      let balance = 50;
      for (let i = 0; i < 6; i++) {
        const pay = Number(g.between(0.8, 2.6).toFixed(8));
        const fee = 0.00012;
        const change = Number((balance - pay - fee).toFixed(8));
        const outs: Utxo[] = g.next() < 0.5 ? [{ addr: g.address('btc'), value: pay }, { addr: S, value: change }] : [{ addr: S, value: change }, { addr: g.address('btc'), value: pay }];
        txs.push(btcTx(g, S, t0 + (i + 1) * 7 * HOUR, [{ addr: S, value: balance }], outs));
        balance = change;
      }
      txs.push(btcTx(g, S, t0 + 2 * DAY, [{ addr: S, value: balance }], [{ addr: g.address('btc'), value: Number((balance - 0.0002).toFixed(8)) }]));
      return {
        profile: profileFor('btc', S, txs),
        txs,
        extraLabels: { [hacker]: label('交易所駭客（模擬）', 'scam') },
        now: SCENARIO_NOW,
        notes: [SYNTHETIC_NOTE],
      };
    },
  },
  {
    meta: {
      id: 's5',
      title: 'Whirlpool CoinJoin 混幣',
      chain: 'btc',
      summary: '自交易所提出 BTC 後拆成 0.05 BTC 預混輸出，參與三輪 5 進 5 出、等額輸出的 CoinJoin。',
      typologies: ['混幣', 'CoinJoin'],
      expected: { levels: ['medium', 'high'], rules: ['R05'] },
    },
    build() {
      const g = new Gen('s5');
      const S = g.address('btc');
      const t0 = SCENARIO_NOW - 6 * DAY;
      const txs: NormTx[] = [btcTx(g, S, t0, [{ addr: BINANCE_BTC_COLD, value: 12.5 }], [{ addr: S, value: 0.2 }, { addr: BINANCE_BTC_COLD, value: 12.2998 }])];
      // Tx0: split into premix outputs + coordinator fee.
      txs.push(btcTx(g, S, t0 + 3 * HOUR, [{ addr: S, value: 0.2 }], [
        { addr: S, value: 0.0502 }, { addr: S, value: 0.0502 }, { addr: S, value: 0.0502 },
        { addr: g.address('btc'), value: 0.0025 }, { addr: S, value: 0.0465 },
      ]));
      for (let i = 0; i < 3; i++) {
        const inputs: Utxo[] = [{ addr: S, value: 0.0502 }, ...Array.from({ length: 4 }, () => ({ addr: g.address('btc'), value: 0.0502 }))];
        const outputs: Utxo[] = Array.from({ length: 5 }, () => ({ addr: g.address('btc'), value: 0.05 }));
        txs.push(btcTx(g, S, t0 + (5 + i * 9) * HOUR, inputs, outputs));
      }
      return { profile: profileFor('btc', S, txs), txs, now: SCENARIO_NOW, notes: [SYNTHETIC_NOTE] };
    },
  },
  {
    meta: {
      id: 's6',
      title: '地址投毒受害者',
      chain: 'tron',
      summary: '使用者固定轉 USDT 給合作夥伴；攻擊者以首尾相同的相似地址發送 0 元與假 USDT，使用者隔天複製錯誤地址轉出 50,000 USDT。',
      typologies: ['地址投毒', '詐騙'],
      expected: { levels: ['high'], rules: ['R14A', 'R14B'] },
    },
    build() {
      const g = new Gen('s6');
      const chain = 'tron';
      const S = g.address(chain);
      const partner = g.address(chain);
      const fake = g.lookalike(chain, partner);
      const exchange = g.address(chain);
      const usdt = { symbol: 'USDT', contract: USDT_TRON, decimals: 6 };
      const t0 = SCENARIO_NOW - 30 * DAY;
      const txs: NormTx[] = [
        acctTx(g, chain, S, { ...usdt, dir: 'in', cp: exchange, amount: 20_000, ts: t0 }),
        acctTx(g, chain, S, { ...usdt, dir: 'in', cp: exchange, amount: 61_250, ts: t0 + 9 * DAY }),
      ];
      let ts = t0;
      for (let i = 0; i < 4; i++) {
        ts = t0 + (i * 6 + 1) * DAY;
        txs.push(acctTx(g, chain, S, { ...usdt, dir: 'out', cp: partner, amount: g.amount(2_000, 8_000, 2), ts }));
      }
      txs.push(acctTx(g, chain, S, { ...usdt, dir: 'in', cp: fake, amount: 0, ts: ts + 2 * MIN }));
      txs.push(acctTx(g, chain, S, { symbol: 'USDT', contract: FAKE_USDT_TRON, decimals: 6, dir: 'in', cp: fake, amount: 5_000, usd: null, ts: ts + 3 * MIN }));
      txs.push(acctTx(g, chain, S, { ...usdt, dir: 'out', cp: fake, amount: 50_000, ts: ts + DAY + 4 * HOUR }));
      return {
        profile: profileFor(chain, S, txs),
        txs,
        extraLabels: { [exchange]: label('交易所熱錢包（模擬）', 'exchange') },
        now: SCENARIO_NOW,
        notes: [SYNTHETIC_NOTE],
      };
    },
  },
  {
    meta: {
      id: 's7',
      title: '跨鏈橋快速分層 + 資金分散',
      chain: 'bsc',
      summary: '經 Stargate 跨鏈轉入大額 BSC-USD 後，1 小時內分散至 22 個新地址並轉往 Wormhole／cBridge，多輪跨鏈跳轉。',
      typologies: ['跨鏈', '分層', '分散'],
      expected: { levels: ['high', 'critical'], rules: ['R07', 'R09B', 'R16'] },
    },
    build() {
      const g = new Gen('s7');
      const chain = 'bsc';
      const S = g.address(chain);
      const usd = { symbol: 'BSC-USD', contract: BSC_USD, decimals: 18 };
      const t0 = SCENARIO_NOW - 8 * DAY;
      const txs: NormTx[] = [acctTx(g, chain, S, { ...usd, dir: 'in', cp: STARGATE_BSC, amount: 180_000, ts: t0 })];
      for (let i = 0; i < 22; i++) {
        txs.push(acctTx(g, chain, S, { ...usd, dir: 'out', cp: g.address(chain), amount: g.amount(5_000, 6_100, 2), ts: t0 + (3 + i * 2) * MIN }));
      }
      txs.push(acctTx(g, chain, S, { ...usd, dir: 'out', cp: WORMHOLE_BSC, amount: 45_000, ts: t0 + 50 * MIN }));
      txs.push(acctTx(g, chain, S, { ...usd, dir: 'in', cp: WORMHOLE_BSC, amount: 120_000, ts: t0 + 3 * DAY }));
      txs.push(acctTx(g, chain, S, { ...usd, dir: 'out', cp: STARGATE_BSC, amount: 118_400, ts: t0 + 3 * DAY + 41 * MIN }));
      txs.push(acctTx(g, chain, S, { ...usd, dir: 'in', cp: STARGATE_BSC, amount: 90_000, ts: t0 + 5 * DAY }));
      txs.push(acctTx(g, chain, S, { ...usd, dir: 'out', cp: CBRIDGE_BSC, amount: 88_650, ts: t0 + 5 * DAY + 26 * MIN }));
      txs.push(acctTx(g, chain, S, { dir: 'in', cp: g.address(chain), amount: 0.0831, ts: t0 - 2 * HOUR }));
      return { profile: profileFor(chain, S, txs), txs, now: SCENARIO_NOW, notes: [SYNTHETIC_NOTE] };
    },
  },
  {
    meta: {
      id: 's8',
      title: '休眠巨鯨活化',
      chain: 'eth',
      summary: '2024 年前累積逾 2,000 ETH 的地址沉寂 480 天後，於 3 天內將約 1,850 ETH 轉往新地址與交易所。',
      typologies: ['休眠活化'],
      expected: { levels: ['medium'], rules: ['R12'] },
    },
    build() {
      const g = new Gen('s8');
      const chain = 'eth';
      const S = g.address(chain);
      const t0 = SCENARIO_NOW - 900 * DAY;
      const sources = [COINBASE_10, KRAKEN];
      const txs: NormTx[] = Array.from({ length: 6 }, (_, i) =>
        acctTx(g, chain, S, { dir: 'in', cp: sources[i % 2], amount: g.amount(250, 480, 3), ts: t0 + i * 70 * DAY }),
      );
      const t1 = SCENARIO_NOW - 5 * DAY;
      txs.push(acctTx(g, chain, S, { dir: 'out', cp: g.address(chain), amount: 812.43, ts: t1 }));
      txs.push(acctTx(g, chain, S, { dir: 'out', cp: g.address(chain), amount: 637.9, ts: t1 + DAY }));
      txs.push(acctTx(g, chain, S, { dir: 'out', cp: BINANCE_14, amount: 402.17, ts: t1 + 2 * DAY }));
      return { profile: profileFor(chain, S, txs), txs, now: SCENARIO_NOW, notes: [SYNTHETIC_NOTE] };
    },
  },
  {
    meta: {
      id: 's9',
      title: '一般散戶（對照組）',
      chain: 'eth',
      summary: '每月自交易所提領小額 ETH，零星轉帳給朋友與 DeFi 協議，行為規律、金額不規則。',
      typologies: ['對照組'],
      expected: { levels: ['low'], rules: [] },
    },
    build() {
      const g = new Gen('s9');
      const chain = 'eth';
      const S = g.address(chain);
      const friends = Array.from({ length: 4 }, () => g.address(chain));
      const t0 = SCENARIO_NOW - 360 * DAY;
      const txs: NormTx[] = [];
      for (let m = 0; m < 12; m++) {
        const ts = t0 + m * 30 * DAY + g.int(0, 3) * DAY + g.int(8, 20) * HOUR;
        txs.push(acctTx(g, chain, S, { dir: 'in', cp: BINANCE_14, amount: g.amount(0.31, 0.88), ts }));
        txs.push(acctTx(g, chain, S, { dir: 'out', cp: friends[m % 4], amount: g.amount(0.0312, 0.2147), ts: ts + g.int(2, 9) * DAY }));
      }
      return { profile: profileFor(chain, S, txs), txs, now: SCENARIO_NOW, notes: [SYNTHETIC_NOTE] };
    },
  },
  {
    meta: {
      id: 's10',
      title: '交易所熱錢包（減權對照組）',
      chain: 'eth',
      summary: '交易所熱錢包一天內收到大量用戶充值並定時歸集至冷錢包；行為類規則觸發但依交易所減權機制降低分數。',
      typologies: ['對照組', '交易所'],
      expected: { levels: ['low', 'medium'], rules: ['R09A'] },
    },
    build() {
      const g = new Gen('s10');
      const chain = 'eth';
      const S = g.address(chain);
      const cold = g.address(chain);
      const t0 = SCENARIO_NOW - 2 * DAY;
      const txs: NormTx[] = [];
      let pending = 0;
      for (let i = 0; i < 40; i++) {
        const amount = g.amount(0.05, 0.9);
        pending += amount;
        txs.push(acctTx(g, chain, S, { dir: 'in', cp: g.address(chain), amount, ts: t0 + i * 30 * MIN }));
        if (i % 10 === 9) {
          txs.push(acctTx(g, chain, S, { dir: 'out', cp: cold, amount: Number((pending * 0.97).toFixed(4)), ts: t0 + i * 30 * MIN + 10 * MIN }));
          pending *= 0.03;
        }
      }
      const exch = label('交易所熱錢包（模擬）', 'exchange');
      return {
        profile: profileFor(chain, S, txs, { labels: exch }),
        txs,
        extraLabels: { [S]: exch, [cold]: label('交易所冷錢包（模擬）', 'exchange') },
        now: SCENARIO_NOW,
        notes: [SYNTHETIC_NOTE],
      };
    },
  },
];

export const SCENARIOS: ScenarioMeta[] = SCENARIO_DEFS.map((d) => d.meta);

export function buildScenario(id: string): ScenarioData | undefined {
  const def = SCENARIO_DEFS.find((d) => d.meta.id === id);
  if (!def) return undefined;
  return { ...def.build(), meta: def.meta };
}

export type { CounterpartyExposure };
