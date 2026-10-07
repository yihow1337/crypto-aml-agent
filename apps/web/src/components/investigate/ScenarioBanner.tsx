import Link from 'next/link';
import { LEVEL_ZH, type RiskLevel, type ScenarioMeta } from '@aml/engine';
import { CircleCheck, FlaskConical, TriangleAlert } from 'lucide-react';
import { ChainBadge, SeverityChip, Tag } from '@/components/ui/badges';

export function ScenarioBanner({ meta, actual }: { meta: ScenarioMeta; actual?: RiskLevel }) {
  const matches = actual ? meta.expected.levels.includes(actual) : undefined;
  return (
    <section
      aria-label="情境說明"
      className="rounded-xl border border-risk-medium/35 bg-risk-medium/[0.06] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="warn">
          <FlaskConical className="size-3" aria-hidden />
          洗錢情境 {meta.id.toUpperCase()}
        </Tag>
        <ChainBadge chain={meta.chain} full />
        {meta.typologies.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
        <Link href="/scenarios" className="ml-auto text-xs text-accent-ink underline underline-offset-2">
          所有情境
        </Link>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-ink">{meta.title}</h2>
      <p className="mt-1 text-sm text-ink-2">{meta.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span>預期等級：</span>
        {meta.expected.levels.map((l) => (
          <SeverityChip key={l} level={l} size="xs" />
        ))}
        {meta.expected.rules.length > 0 && (
          <>
            <span className="ml-2">預期規則：</span>
            {meta.expected.rules.map((r) => (
              <Tag key={r}>{r}</Tag>
            ))}
          </>
        )}
        {matches !== undefined && (
          <span className="ml-auto inline-flex items-center gap-1 text-ink-2">
            {matches ? (
              <CircleCheck className="size-3.5 text-risk-low" aria-hidden />
            ) : (
              <TriangleAlert className="size-3.5 text-risk-medium" aria-hidden />
            )}
            實際結果：{LEVEL_ZH[actual!]}風險{matches ? '（符合預期）' : '（與預期不同）'}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-3">
        本情境為合成資料（地址與交易雜湊為隨機產生），因此不提供區塊鏈瀏覽器連結。
      </p>
    </section>
  );
}
