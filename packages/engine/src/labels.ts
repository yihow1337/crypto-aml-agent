import { normalizeAddress } from './address';
import type { AddressLabel, Chain, LabelCategory } from './types';

interface LabelEntry {
  address: string;
  name: string;
  category: LabelCategory;
}

/**
 * Hand-curated labels. ETH entries were cross-checked against Blockscout contract names
 * (2026-10). Tornado Cash is a mixer label only: OFAC delisted it in March 2025.
 */
const CURATED: Record<Chain, LabelEntry[]> = {
  eth: [
    { address: '0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b', name: 'Tornado Cash: Router', category: 'mixer' },
    { address: '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc', name: 'Tornado Cash: 0.1 ETH', category: 'mixer' },
    { address: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936', name: 'Tornado Cash: 1 ETH', category: 'mixer' },
    { address: '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF', name: 'Tornado Cash: 10 ETH', category: 'mixer' },
    { address: '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291', name: 'Tornado Cash: 100 ETH', category: 'mixer' },
    { address: '0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3', name: 'Tornado Cash: 100 DAI', category: 'mixer' },
    { address: '0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144', name: 'Tornado Cash: 1,000 DAI', category: 'mixer' },
    { address: '0xF60dD140cFf0706bAE9Cd734Ac3ae76AD9eBC32A', name: 'Tornado Cash: 10,000 DAI', category: 'mixer' },
    { address: '0xd96f2B1c14Db8458374d9Aca76E26c3D18364307', name: 'Tornado Cash: 100 USDC', category: 'mixer' },
    { address: '0x4736dCf1b7A3d580672CcE6E7c65cd5cc9cFBa9D', name: 'Tornado Cash: 1,000 USDC', category: 'mixer' },
    { address: '0x169AD27A470D064DEDE56a2D3ff727986b15D52B', name: 'Tornado Cash: 100 USDT', category: 'mixer' },
    { address: '0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f', name: 'Tornado Cash: 1,000 USDT', category: 'mixer' },
    { address: '0x28C6c06298d514Db089934071355E5743bf21d60', name: 'Binance 14', category: 'exchange' },
    { address: '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', name: 'Binance 15', category: 'exchange' },
    { address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', name: 'Binance 16', category: 'exchange' },
    { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', name: 'Binance 7', category: 'exchange' },
    { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', name: 'Binance 8', category: 'exchange' },
    { address: '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', name: 'Coinbase 10', category: 'exchange' },
    { address: '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2', name: 'Kraken', category: 'exchange' },
    { address: '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b', name: 'OKX', category: 'exchange' },
    { address: '0xab5C66752a9e8167967685F1450532fB96d5d24f', name: 'HTX (Huobi)', category: 'exchange' },
    { address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', name: 'Bybit: Hot Wallet', category: 'exchange' },
    { address: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', name: 'Wormhole: Token Bridge', category: 'bridge' },
    { address: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5', name: 'Across: SpokePool', category: 'bridge' },
    { address: '0x8731d54E9D02c286767d56ac03e8037C07e01e98', name: 'Stargate: Router', category: 'bridge' },
    { address: '0xb8901acB165ed027E32754E0FFe830802919727f', name: 'Hop: ETH Bridge', category: 'bridge' },
    { address: '0x2796317b0fF8538F253012862c06787Adfb8cEb6', name: 'Synapse: Bridge', category: 'bridge' },
    { address: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77', name: 'Polygon: PoS Bridge', category: 'bridge' },
    { address: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f', name: 'Arbitrum: Delayed Inbox', category: 'bridge' },
    { address: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1', name: 'Optimism: Gateway', category: 'bridge' },
    { address: '0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146', name: 'THORChain: Router', category: 'bridge' },
    { address: '0x80C67432656d59144cEFf962E8fAF8926599bCF8', name: 'Orbiter Finance: Maker', category: 'bridge' },
    { address: '0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820', name: 'Celer: cBridge', category: 'bridge' },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether: USDT', category: 'stablecoin' },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'Circle: USDC', category: 'stablecoin' },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'Maker: DAI', category: 'stablecoin' },
  ],
  bsc: [
    { address: '0x84443CFd09A48AF6eF360C6976C5392aC5023a1F', name: 'Tornado Cash: 0.1 BNB', category: 'mixer' },
    { address: '0xd47438C816c9E7f2E2888E060936a499Af9582b3', name: 'Tornado Cash: 1 BNB', category: 'mixer' },
    { address: '0x330bdFADE01eE9bF63C209Ee33102DD334618e0a', name: 'Tornado Cash: 10 BNB', category: 'mixer' },
    { address: '0x1E34A77868E19A6647b1f2F47B51ed72dEDE95DD', name: 'Tornado Cash: 100 BNB', category: 'mixer' },
    { address: '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3', name: 'Binance: Hot Wallet 6', category: 'exchange' },
    { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', name: 'Binance 8', category: 'exchange' },
    { address: '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8', name: 'Stargate: Router', category: 'bridge' },
    { address: '0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7', name: 'Wormhole: Token Bridge', category: 'bridge' },
    { address: '0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF', name: 'Celer: cBridge', category: 'bridge' },
    { address: '0x55d398326f99059fF775485246999027B3197955', name: 'Binance-Peg BSC-USD (USDT)', category: 'stablecoin' },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', name: 'Binance-Peg USDC', category: 'stablecoin' },
    { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', name: 'BUSD', category: 'stablecoin' },
  ],
  tron: [
    { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', name: 'Tether: USDT (TRC-20)', category: 'stablecoin' },
    { address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', name: 'Circle: USDC (TRC-20)', category: 'stablecoin' },
  ],
  btc: [
    { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', name: 'Binance: Cold Wallet', category: 'exchange' },
    { address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', name: 'Bitfinex: Cold Wallet', category: 'exchange' },
  ],
};

const INDEX: Record<Chain, Map<string, LabelEntry>> = {
  eth: new Map(),
  bsc: new Map(),
  tron: new Map(),
  btc: new Map(),
};
for (const chain of Object.keys(CURATED) as Chain[]) {
  for (const e of CURATED[chain]) INDEX[chain].set(normalizeAddress(chain, e.address), e);
}

export function curatedLabels(chain: Chain, address: string): AddressLabel[] {
  const e = INDEX[chain].get(normalizeAddress(chain, address));
  return e ? [{ name: e.name, category: e.category, source: 'curated' }] : [];
}

export function allCuratedEntries(chain: Chain): readonly LabelEntry[] {
  return CURATED[chain];
}

export interface BlockscoutTag {
  slug: string;
  name: string;
  tagType?: string;
}

const TAG_RULES: [RegExp, LabelCategory][] = [
  [/sanction|ofac/i, 'sanctioned'],
  [/phish|scam|exploit|hack|heist|drainer|fake/i, 'scam'],
  [/tornado|mixer|mixing|blender|sinbad|railgun/i, 'mixer'],
  [/gambl|casino|betting/i, 'gambling'],
  [/bridge|wormhole|stargate|across|hop-protocol|synapse|orbiter|cbridge|layerzero/i, 'bridge'],
  [/exchange|binance|coinbase|kraken|okx|okex|bybit|bitfinex|huobi|htx|kucoin|gate-io|bitget|mexc|crypto-com/i, 'exchange'],
];

/** Map Blockscout `metadata.tags` to label categories; unrecognised tags are dropped. */
export function labelsFromBlockscoutTags(tags: BlockscoutTag[] | null | undefined): AddressLabel[] {
  const out: AddressLabel[] = [];
  for (const tag of tags ?? []) {
    if (tag.tagType === 'note') continue;
    const text = `${tag.slug} ${tag.name}`;
    const rule = TAG_RULES.find(([re]) => re.test(text));
    if (rule) out.push({ name: tag.name.slice(0, 60), category: rule[1], source: 'blockscout' });
  }
  return out;
}

export const CATEGORY_RISK: Record<LabelCategory, number> = {
  sanctioned: 1,
  mixer: 0.9,
  scam: 0.9,
  high_risk: 0.7,
  gambling: 0.5,
  bridge: 0.3,
  other: 0.2,
  exchange: 0.1,
  defi: 0.1,
  service: 0.1,
  stablecoin: 0,
};

export const CATEGORY_ZH: Record<LabelCategory | 'subject' | 'unknown', string> = {
  sanctioned: '制裁名單',
  mixer: '混幣器',
  scam: '詐騙/釣魚',
  high_risk: '高風險服務',
  gambling: '博弈',
  bridge: '跨鏈橋',
  other: '其他',
  exchange: '交易所',
  defi: 'DeFi',
  service: '服務商',
  stablecoin: '穩定幣合約',
  subject: '調查對象',
  unknown: '未標記',
};

const UNLABELED_RISK = 0.15;

export function labelRisk(labels: AddressLabel[]): number {
  if (labels.length === 0) return UNLABELED_RISK;
  return Math.max(...labels.map((l) => CATEGORY_RISK[l.category]));
}

export function primaryCategory(labels: AddressLabel[]): LabelCategory | 'unknown' {
  if (labels.length === 0) return 'unknown';
  return labels.reduce((best, l) => (CATEGORY_RISK[l.category] > CATEGORY_RISK[best.category] ? l : best))
    .category;
}

export function hasCategory(labels: AddressLabel[], ...categories: LabelCategory[]): boolean {
  return labels.some((l) => categories.includes(l.category));
}

/** Canonical stablecoin contracts; a transfer using these symbols from another contract is fake. */
const CANONICAL_STABLES: Record<Chain, Record<string, string[]>> = {
  eth: {
    USDT: ['0xdac17f958d2ee523a2206206994597c13d831ec7'],
    USDC: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
    DAI: ['0x6b175474e89094c44da98b954eedeac495271d0f'],
  },
  bsc: {
    USDT: ['0x55d398326f99059ff775485246999027b3197955'],
    'BSC-USD': ['0x55d398326f99059ff775485246999027b3197955'],
    USDC: ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'],
    BUSD: ['0xe9e7cea3dedca5984780bafc599bd69add087d56'],
  },
  tron: {
    USDT: ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    USDC: ['TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8'],
  },
  btc: {},
};

export function isStableSymbol(symbol: string): boolean {
  return /^(USDT|USDC|DAI|BUSD|BSC-USD|TUSD|FDUSD|USDD)$/i.test(symbol.trim());
}

/** True when `contract` is the canonical contract for a stablecoin `symbol` on `chain`. */
export function isCanonicalStablecoin(chain: Chain, symbol: string, contract: string | undefined): boolean {
  const canon = CANONICAL_STABLES[chain][symbol.trim().toUpperCase()];
  return !!canon && !!contract && canon.includes(normalizeAddress(chain, contract));
}

export function isFakeStablecoin(chain: Chain, symbol: string, contract: string | undefined): boolean {
  const canon = CANONICAL_STABLES[chain][symbol.trim().toUpperCase()];
  if (!canon || !contract) return false;
  return !canon.includes(normalizeAddress(chain, contract));
}
