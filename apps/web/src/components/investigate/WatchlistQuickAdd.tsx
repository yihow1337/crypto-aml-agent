'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Chain } from '@aml/engine';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api, describeError } from '@/lib/api';

/** One-click "加入監控名單" for the investigated address. */
export function WatchlistQuickAdd({
  chain,
  address,
  defaultLabel,
}: {
  chain: Chain;
  address: string;
  defaultLabel?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (state === 'done') {
    return (
      <Link href="/watchlist" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-ink-2 hover:bg-raised">
        <Check className="size-3.5 text-risk-low" aria-hidden />
        已加入監控名單
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            await api.addWatchlist({ chain, address, label: (defaultLabel ?? '').slice(0, 40) || '調查對象' });
            setState('done');
          } catch (err) {
            const d = describeError(err);
            setMessage(d.detail ? `${d.title}（${d.detail}）` : d.title);
            setState('error');
          }
        }}
      >
        <Plus className="size-3.5" aria-hidden />
        加入監控名單
      </Button>
      {state === 'error' && (
        <span role="alert" className="text-xs text-ink-2">
          {message}
        </span>
      )}
    </span>
  );
}
