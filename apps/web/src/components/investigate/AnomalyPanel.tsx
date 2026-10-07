'use client';

import { fmtUsd, type NormTx } from '@aml/engine';
import { Cpu } from 'lucide-react';
import { AnomalyScatter } from '@/components/charts/AnomalyScatter';
import { EmptyState, Notice } from '@/components/ui/feedback';
import type { IsolationForestState } from '@/hooks/useIsolationForest';
import { fmtDateTime, fmtMs } from '@/lib/format';
import { inkOn, seqColor } from '@/lib/theme';

export function AnomalyPanel({
  txs,
  forest,
  range,
  labelOf,
  onPick,
}: {
  txs: NormTx[];
  forest: IsolationForestState;
  range: [number, number];
  labelOf: (address: string) => string | undefined;
  onPick: (hash: string) => void;
}) {
  const r = forest.result;
  if (!r || r.insufficient) {
    return (
      <EmptyState
        icon={Cpu}
        title={`樣本不足（需 ≥${forest.minSamples} 筆）`}
        description={`目前僅有 ${forest.n} 筆成功交易，Isolation Forest 需要足夠樣本才能估計「正常」行為的分布。`}
      />
    );
  }
  const byHash = new Map(txs.map((t) => [t.hash, t]));
  const [lo, hi] = range;
  const top = r.flagged.slice(0, 8);
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <div className="min-w-0 xl:col-span-8">
        <AnomalyScatter txs={txs} anomaly={r} labelOf={labelOf} onPick={onPick} />
      </div>
      <div className="min-w-0 space-y-3 xl:col-span-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="樣本數" value={String(forest.n)} />
          <Stat label="標記門檻" value={r.threshold.toFixed(2)} />
          <Stat label="異常標記" value={String(r.flagged.length)} />
        </dl>
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-ink-2">最異常的交易</h3>
          {top.length === 0 ? (
            <p className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-3">沒有交易超過門檻。</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {top.map((f) => {
                const t = byHash.get(f.hash);
                const bg = seqColor((f.score - lo) / (hi - lo || 1));
                return (
                  <li key={f.hash}>
                    <button
                      type="button"
                      onClick={() => onPick(f.hash)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised/60"
                      title="在交易明細中定位"
                    >
                      <span
                        className="tabular shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: bg, color: inkOn(bg) }}
                      >
                        {f.score.toFixed(2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{f.reason}</span>
                        <span className="block text-[11px] text-ink-3">
                          {t ? `${fmtDateTime(t.ts)} · ${t.direction === 'in' ? '轉入' : t.direction === 'out' ? '轉出' : '自轉'} · ${fmtUsd(t.usd)}` : f.hash}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Notice icon={Cpu}>
          ML 異常分數僅供輔助參考，<strong className="text-ink">與官方風險分數分開呈現、不影響規則評分</strong>。模型於瀏覽器端即時計算（{fmtMs(forest.ms)}），以地址為亂數種子，結果可重現。
        </Notice>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-2 py-2">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="text-lg font-bold text-ink">{value}</dd>
    </div>
  );
}
