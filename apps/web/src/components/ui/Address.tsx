'use client';

import { useEffect, useRef, useState } from 'react';
import { shortAddress, type Chain } from '@aml/engine';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/download';
import { addressUrl, EXPLORER_NAME, txUrl } from '@/lib/explorer';

export function CopyButton({ value, label = '複製', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const ok = await copyText(value);
        if (!ok) return;
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        'no-print inline-grid size-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink',
        className,
      )}
      aria-label={copied ? '已複製' : `${label}：${value}`}
      title={copied ? '已複製' : label}
    >
      {copied ? <Check className="size-3.5 text-risk-low" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {copied ? '已複製' : ''}
      </span>
    </button>
  );
}

function ExplorerLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="no-print inline-grid size-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-accent-ink"
      title={title}
      aria-label={title}
    >
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

interface AddressProps {
  address: string;
  chain?: Chain;
  /** Render a block-explorer link (disable for synthetic scenario data). */
  linkable?: boolean;
  full?: boolean;
  head?: number;
  tail?: number;
  copy?: boolean;
  className?: string;
  textClassName?: string;
}

/** Monospace address: short form with the full value in the tooltip, plus copy / explorer actions. */
export function AddressText({
  address,
  chain,
  linkable = false,
  full = false,
  head = 6,
  tail = 4,
  copy = true,
  className,
  textClassName,
}: AddressProps) {
  const href = linkable && chain ? addressUrl(chain, address) : null;
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle', className)}>
      <span
        title={address}
        className={cn('min-w-0 font-mono text-[0.92em] text-ink', full ? 'break-all' : 'truncate', textClassName)}
      >
        {full ? address : shortAddress(address, head, tail)}
      </span>
      {copy && <CopyButton value={address} label="複製地址" />}
      {href && chain && <ExplorerLink href={href} title={`在 ${EXPLORER_NAME[chain]} 檢視地址`} />}
    </span>
  );
}

/** Transaction hash with copy and (optionally) explorer link. */
export function HashText({
  hash,
  chain,
  linkable = false,
  className,
}: {
  hash: string;
  chain: Chain;
  linkable?: boolean;
  className?: string;
}) {
  const href = linkable ? txUrl(chain, hash) : null;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5 align-middle', className)}>
      <span title={hash} className="truncate font-mono text-[0.92em] text-ink-2">
        {shortAddress(hash, 8, 6)}
      </span>
      <CopyButton value={hash} label="複製交易雜湊" />
      {href && <ExplorerLink href={href} title={`在 ${EXPLORER_NAME[chain]} 檢視交易`} />}
    </span>
  );
}
