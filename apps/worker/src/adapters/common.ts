import {
  type AddressLabel,
  type Chain,
  isCanonicalStablecoin,
  isFakeStablecoin,
  labelsFromBlockscoutTags,
  type BlockscoutTag,
  sanitizeText,
} from '@aml/engine';

export const SPAM_NOTE = '已排除無報價的代幣轉帳（多為空投垃圾代幣），僅保留有報價、主流穩定幣及疑似假冒穩定幣的轉帳。';
export const PRICE_NOTE = 'USD 金額以目前市價估算，非交易當時價格。';

export interface BlockscoutParty {
  hash: string;
  name?: string | null;
  is_scam?: boolean;
  is_contract?: boolean;
  reputation?: string | null;
  metadata?: { tags?: BlockscoutTag[] } | null;
}

const NAME_RULES: [RegExp, AddressLabel['category']][] = [
  [/tornado|mixer/i, 'mixer'],
  [/bridge|wormhole|stargate|spokepool|cbridge|thorchain/i, 'bridge'],
];

/** Labels for a Blockscout address object (tags, scam flag, verified contract name). */
export function labelsFromBlockscoutParty(p: BlockscoutParty | null | undefined): AddressLabel[] {
  if (!p) return [];
  const labels = labelsFromBlockscoutTags(p.metadata?.tags).map((l) => ({ ...l, name: sanitizeText(l.name) }));
  if (p.is_scam || (p.reputation && p.reputation !== 'ok')) {
    labels.push({ name: 'Blockscout：疑似詐騙地址', category: 'scam', source: 'blockscout' });
  }
  if (p.name) {
    const rule = NAME_RULES.find(([re]) => re.test(p.name!));
    if (rule) labels.push({ name: sanitizeText(p.name), category: rule[1], source: 'blockscout' });
  }
  return labels;
}

export type TokenDecision = { keep: false } | { keep: true; usdPerUnit?: number; fake: boolean };

/**
 * Keep a token transfer only if it has a price, is a canonical stablecoin, or impersonates one
 * (address poisoning). Unpriced long-tail tokens are almost always airdrop spam.
 */
export function decideToken(chain: Chain, symbol: string, contract: string, rate?: number | null): TokenDecision {
  const sym = sanitizeText(symbol, 16);
  if (isFakeStablecoin(chain, sym, contract)) return { keep: true, fake: true };
  if (rate && rate > 0) return { keep: true, usdPerUnit: rate, fake: false };
  if (isCanonicalStablecoin(chain, sym, contract)) return { keep: true, usdPerUnit: 1, fake: false };
  return { keep: false };
}

/** Labels from free-text names (e.g. a Zerion application name such as "Tornado Cash"). */
export function labelsFromNames(names: (string | null | undefined)[], source: string): AddressLabel[] {
  const out: AddressLabel[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const name = sanitizeText(raw, 60);
    for (const l of labelsFromBlockscoutTags([{ slug: '', name }])) {
      if (!out.some((o) => o.category === l.category)) out.push({ ...l, name, source });
    }
  }
  return out;
}
