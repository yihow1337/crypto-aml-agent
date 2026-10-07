'use client';

import { useId, useMemo, useState } from 'react';
import { CHAIN_ZH, detectChains, shortAddress, type Chain } from '@aml/engine';
import { CircleCheck, CircleX, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChainBadge } from '@/components/ui/badges';
import { cn } from '@/lib/cn';
import { SAMPLE_ADDRESSES } from '@/lib/samples';
import { CHAIN_SHORT } from '@/lib/theme';

export interface ChainDetection {
  candidates: Chain[];
  chain: Chain | null;
}

/** Address → candidate chains (0x… is ambiguous between ETH and BSC). */
export function useChainDetection(value: string, preferred: Chain | null): ChainDetection {
  return useMemo(() => {
    const candidates = value.trim() ? detectChains(value) : [];
    const chain = preferred && candidates.includes(preferred) ? preferred : (candidates[0] ?? null);
    return { candidates, chain };
  }, [value, preferred]);
}

/** Segmented ETH / BSC toggle (or a static badge when only one chain fits). */
export function ChainPicker({
  candidates,
  value,
  onChange,
  unavailable,
}: {
  candidates: Chain[];
  value: Chain | null;
  onChange: (c: Chain) => void;
  unavailable?: Partial<Record<Chain, boolean>>;
}) {
  if (candidates.length <= 1) {
    return value ? <ChainBadge chain={value} full /> : null;
  }
  return (
    <div role="radiogroup" aria-label="選擇鏈別" className="inline-flex rounded-lg border border-line-strong bg-sunken p-0.5">
      {candidates.map((c) => {
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c)}
            title={CHAIN_ZH[c] + (unavailable?.[c] ? '（目前無法使用）' : '')}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
              active ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink',
              unavailable?.[c] && !active && 'line-through decoration-ink-3',
            )}
          >
            {CHAIN_SHORT[c]}
          </button>
        );
      })}
    </div>
  );
}

interface AddressInputProps {
  initialAddress?: string;
  initialChain?: Chain | null;
  onSubmit: (chain: Chain, address: string) => void;
  busy?: boolean;
  compact?: boolean;
  showSamples?: boolean;
  submitLabel?: string;
  /** Chains reported unavailable by /api/health. */
  unavailable?: Partial<Record<Chain, boolean>>;
  className?: string;
}

export function AddressInput({
  initialAddress = '',
  initialChain = null,
  onSubmit,
  busy = false,
  compact = false,
  showSamples = true,
  submitLabel = '開始分析',
  unavailable,
  className,
}: AddressInputProps) {
  const [value, setValue] = useState(initialAddress);
  const [preferred, setPreferred] = useState<Chain | null>(initialChain);
  const { candidates, chain } = useChainDetection(value, preferred);
  const hintId = useId();
  const trimmed = value.trim();
  const invalid = trimmed.length > 0 && candidates.length === 0;
  const chainDown = chain ? unavailable?.[chain] : false;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (chain && trimmed && !busy) onSubmit(chain, trimmed);
  };

  return (
    <div className={cn('min-w-0', className)}>
      <form onSubmit={submit} className={cn('flex min-w-0 gap-2', compact ? 'flex-row' : 'flex-col sm:flex-row')}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">區塊鏈地址</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={compact ? '輸入地址快速調查…' : '輸入 ETH / BSC / TRON / BTC 地址'}
            aria-describedby={hintId}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            className={cn(
              'w-full rounded-lg border bg-sunken pl-9 pr-3 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-3 focus:outline-none focus:ring-2',
              compact ? 'h-9' : 'h-11',
              invalid ? 'border-risk-critical/60 focus:ring-risk-critical/40' : 'border-line-strong focus:border-accent focus:ring-accent/30',
            )}
          />
        </label>
        <Button type="submit" variant="primary" size={compact ? 'sm' : 'md'} disabled={!chain || busy} className={compact ? 'h-9' : 'h-11'}>
          <Search className="size-4" aria-hidden />
          {submitLabel}
        </Button>
      </form>

      <div id={hintId} className={cn("flex flex-wrap items-center gap-2 text-xs", compact && !trimmed ? "sr-only" : "mt-2 min-h-6")} aria-live="polite">
        {!trimmed && !compact && <span className="text-ink-3">支援 Ethereum、BNB Smart Chain、TRON、Bitcoin；系統會自動判斷鏈別。</span>}
        {invalid && (
          <span className="inline-flex items-center gap-1 text-ink-2">
            <CircleX className="size-3.5 text-risk-critical" aria-hidden />
            無法辨識的地址格式（請確認大小寫與長度；EVM 地址需通過 EIP-55 校驗）
          </span>
        )}
        {chain && (
          <>
            <span className="inline-flex items-center gap-1 text-ink-3">
              <CircleCheck className="size-3.5 text-risk-low" aria-hidden />
              {candidates.length > 1 ? 'EVM 地址，請選擇鏈別：' : '自動偵測：'}
            </span>
            <ChainPicker candidates={candidates} value={chain} onChange={setPreferred} unavailable={unavailable} />
          </>
        )}
        {chainDown && (
          <span className="inline-flex items-center gap-1 text-ink-2">
            <TriangleAlert className="size-3.5 text-risk-medium" aria-hidden />
            {CHAIN_ZH[chain!]} 目前無法使用（後端未設定資料來源），分析可能失敗。
          </span>
        )}
      </div>

      {showSamples && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-ink-3">範例地址（一鍵分析）：</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_ADDRESSES.map((s) => (
              <button
                key={s.address}
                type="button"
                disabled={busy}
                onClick={() => {
                  setValue(s.address);
                  setPreferred(s.chain);
                  onSubmit(s.chain, s.address);
                }}
                title={`${s.address}｜${s.note}`}
                className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-raised/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-accent/60 hover:bg-raised disabled:opacity-50"
              >
                <ChainBadge chain={s.chain} />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{s.label}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">{shortAddress(s.address, 8, 6)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
