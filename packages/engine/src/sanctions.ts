import { normalizeAddress } from './address';
import { SANCTIONS_SNAPSHOT, SANCTIONS_SNAPSHOT_DATE } from './sanctions/snapshot';
import type { Chain } from './types';

/** Asset codes used by the OFAC SDN list extractions. */
export const SANCTION_ASSETS = ['ETH', 'XBT', 'TRX', 'USDT', 'USDC', 'BSC'] as const;

type Family = 'evm' | 'tron' | 'btc';

function familyOf(address: string): Family | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return 'evm';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return 'tron';
  if (/^(bc1|[13])[0-9A-Za-z]{20,90}$/.test(address)) return 'btc';
  return null;
}

function familyForChain(chain: Chain): Family {
  return chain === 'eth' || chain === 'bsc' ? 'evm' : chain;
}

/**
 * OFAC SDN digital-currency addresses. EVM lists (ETH, BSC, USDT/USDC on EVM) are merged
 * because the same key controls an address on every EVM chain.
 */
export class SanctionsIndex {
  private readonly sets: Record<Family, Set<string>> = {
    evm: new Set(),
    tron: new Set(),
    btc: new Set(),
  };

  private constructor(readonly updatedAt: string) {}

  static fromLists(lists: Record<string, string[]>, updatedAt: string): SanctionsIndex {
    const idx = new SanctionsIndex(updatedAt);
    for (const addresses of Object.values(lists)) {
      for (const raw of addresses) {
        const a = raw.trim();
        const fam = familyOf(a);
        if (!fam) continue;
        idx.sets[fam].add(fam === 'evm' ? a.toLowerCase() : fam === 'btc' && a.startsWith('bc1') ? a.toLowerCase() : a);
      }
    }
    return idx;
  }

  static fromSnapshot(): SanctionsIndex {
    return SanctionsIndex.fromLists(SANCTIONS_SNAPSHOT, SANCTIONS_SNAPSHOT_DATE);
  }

  has(chain: Chain, address: string): boolean {
    if (!address) return false;
    return this.sets[familyForChain(chain)].has(normalizeAddress(chain, address));
  }

  counts(): { evm: number; tron: number; btc: number; total: number } {
    const evm = this.sets.evm.size;
    const tron = this.sets.tron.size;
    const btc = this.sets.btc.size;
    return { evm, tron, btc, total: evm + tron + btc };
  }

  /** All sanctioned addresses for a chain family (used by the monitoring sweep). */
  addresses(chain: Chain): string[] {
    return [...this.sets[familyForChain(chain)]];
  }
}
