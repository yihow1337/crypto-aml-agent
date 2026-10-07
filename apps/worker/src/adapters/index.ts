import type { Chain, ChainStatus } from '@aml/engine';
import type { Env } from '../env';
import type { SubrequestBudget } from '../lib/http';
import type { PriceTable } from '../lib/prices';
import { BtcMempoolSource } from './btc-mempool';
import { EthBlockscoutSource } from './eth-blockscout';
import { FallbackSource } from './fallback';
import { ZerionSource } from './zerion';
import { TronGridSource } from './tron-trongrid';
import type { DataSource } from './types';

export interface SourceDeps {
  env: Env;
  budget: SubrequestBudget;
  prices: PriceTable;
  onCompute?: (units: number) => void;
}

/** Whether a chain's live data goes through Zerion (and therefore its daily request budget). */
export function usesZerion(chain: Chain, env: Env): boolean {
  return (chain === 'eth' || chain === 'bsc') && Boolean(env.ZERION_API_KEY);
}

export function createSource(chain: Chain, d: SourceDeps): DataSource {
  const base = { budget: d.budget, prices: d.prices, onCompute: d.onCompute };
  switch (chain) {
    case 'eth':
    {
      const blockscout = () => new EthBlockscoutSource({ ...base, apiKey: d.env.BLOCKSCOUT_API_KEY });
      if (!d.env.ZERION_API_KEY) return blockscout();
      return new FallbackSource(
        new ZerionSource('eth', { ...base, apiKey: d.env.ZERION_API_KEY }),
        blockscout,
        'Zerion 不追蹤此地址（多為交易所熱錢包等超大量地址），已改用 Blockscout 公開資料。',
      );
    }
    case 'bsc':
      return new ZerionSource('bsc', { ...base, apiKey: d.env.ZERION_API_KEY });
    case 'tron':
      return new TronGridSource({ ...base, apiKey: d.env.TRONGRID_API_KEY });
    case 'btc':
      return new BtcMempoolSource(base);
  }
}

export function chainStatus(env: Env): Record<Chain, ChainStatus> {
  const zerion = Boolean(env.ZERION_API_KEY);
  return {
    eth: zerion
      ? { available: true, source: 'Zerion' }
      : { available: true, source: 'Blockscout', note: env.BLOCKSCOUT_API_KEY ? undefined : '公開端點，尖峰時段可能限流' },
    bsc: zerion
      ? { available: true, source: 'Zerion' }
      : { available: false, source: 'Zerion', note: '未設定 ZERION_API_KEY，僅能使用內建情境' },
    tron: { available: true, source: 'TronGrid', note: env.TRONGRID_API_KEY ? undefined : '未設定 API 金鑰，可能受限流' },
    btc: { available: true, source: 'mempool.space' },
  };
}
