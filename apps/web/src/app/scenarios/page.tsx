import type { Metadata } from 'next';
import Link from 'next/link';
import { CHAIN_ZH, SCENARIOS } from '@aml/engine';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { buttonClass } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/Card';
import { ChainBadge, SeverityChip, Tag } from '@/components/ui/badges';
import { Notice } from '@/components/ui/feedback';

export const metadata: Metadata = {
  title: '洗錢情境',
  description: '10 個合成洗錢情境：制裁、混幣、結構化、剝離鏈、CoinJoin、地址投毒、跨鏈分層、休眠活化與對照組。',
};

export default function ScenariosPage() {
  return (
    <div>
      <PageHeader
        title="洗錢情境"
        icon={FlaskConical}
        description="以合成資料重現常見的加密貨幣洗錢手法（typology），用於展示與驗證偵測規則。每個情境都標註預期風險等級與應觸發的規則，可直接比對系統輸出。"
      />
      <Notice className="mb-6">
        情境資料由引擎以固定亂數種子產生：地址與交易雜湊為隨機值（少數引用公開已知地址，如 Ronin 駭客、Tornado Cash、交易所錢包），
        因此情境模式不提供區塊鏈瀏覽器連結。
      </Notice>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-sm shadow-black/20 transition-colors hover:border-accent/50 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-2">{s.id.toUpperCase()}</span>
              <ChainBadge chain={s.chain} />
              <span className="text-xs text-ink-3">{CHAIN_ZH[s.chain]}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold leading-snug text-ink">{s.title}</h2>
            <p className="mt-2 flex-1 text-sm text-ink-2">{s.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.typologies.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
            <dl className="mt-4 space-y-2 border-t border-line/70 pt-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <dt className="text-ink-3">預期等級</dt>
                <dd className="flex flex-wrap gap-1">
                  {s.expected.levels.map((l) => (
                    <SeverityChip key={l} level={l} size="xs" />
                  ))}
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <dt className="text-ink-3">預期規則</dt>
                <dd className="flex flex-wrap gap-1">
                  {s.expected.rules.length ? (
                    s.expected.rules.map((r) => (
                      <span key={r} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-3">無（對照組）</span>
                  )}
                </dd>
              </div>
            </dl>
            <Link href={`/investigate?scenario=${s.id}`} className={buttonClass('primary', 'sm', 'mt-4 self-start')}>
              查看分析
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
