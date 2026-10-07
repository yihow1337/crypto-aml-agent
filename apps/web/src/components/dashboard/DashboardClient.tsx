'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CHAINS,
  CHAIN_ZH,
  LEVEL_ZH,
  shortAddress,
  type Alert,
  type AlertSource,
  type Chain,
  type HealthResponse,
  type Severity,
} from '@aml/engine';
import {
  Bell,
  Bot,
  CircleCheck,
  CircleX,
  Clock,
  LayoutDashboard,
  ListChecks,
  OctagonAlert,
  RefreshCw,
  Siren,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { ChainSeverityChart, HourlyAlertsChart, RiskLevelBars } from '@/components/charts/DashboardCharts';
import { AddressInput } from '@/components/investigate/AddressInput';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { ChainBadge, SeverityChip, Tag } from '@/components/ui/badges';
import { EmptyState, ErrorBanner, Skeleton } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtInt, fmtRelative, fmtUsdCompact, toMs } from '@/lib/format';
import { CHAIN_SHORT, RISK_ORDER } from '@/lib/theme';

const POLL_MS = 60_000;
const ALERT_LIMIT = 100;

const SOURCE_ZH: Record<AlertSource, string> = {
  sweep: '排程掃描',
  watchlist: '監控名單',
  investigation: '調查',
};

async function loadAlerts(signal: AbortSignal) {
  try {
    return await api.alerts({ limit: ALERT_LIMIT }, signal);
  } catch (err) {
    // Fall back to the documented page size if the API caps `limit` lower.
    if (err instanceof ApiError && err.code === 'BAD_REQUEST') return api.alerts({ limit: 50 }, signal);
    throw err;
  }
}

export function DashboardClient() {
  const router = useRouter();
  const stats = useAsync((s) => api.stats(s), []);
  const alerts = useAsync(loadAlerts, []);
  const health = useAsync((s) => api.health(s), []);
  const [chainFilter, setChainFilter] = useState<Chain | ''>('');
  const [sevFilter, setSevFilter] = useState<Severity | ''>('');

  const refresh = () => {
    stats.reload();
    alerts.reload();
    health.reload();
  };
  usePolling(refresh, POLL_MS);

  const items = useMemo(() => alerts.data?.items ?? [], [alerts.data]);
  const feed = useMemo(
    () => items.filter((a) => (!chainFilter || a.chain === chainFilter) && (!sevFilter || a.severity === sevFilter)),
    [items, chainFilter, sevFilter],
  );
  const last24h = useMemo(() => {
    const since = Date.now() - 86_400_000;
    return items.filter((a) => toMs(a.createdAt) >= since);
  }, [items]);

  const s = stats.data;
  const updatedAt = Math.max(stats.updatedAt ?? 0, alerts.updatedAt ?? 0) || undefined;
  const offline = stats.error?.code === 'NETWORK_ERROR' && !s;

  return (
    <div className="space-y-6">
      <PageHeader
        title="儀表板"
        icon={LayoutDashboard}
        description="多鏈警示監控總覽：排程掃描與監控名單產生的警示、OFAC 制裁名單狀態與地址風險分布，每 60 秒自動更新（分頁在背景時暫停）。"
        actions={
          <>
            <span className="text-xs text-ink-3" aria-live="polite">
              {updatedAt ? `更新於 ${fmtDateTime(updatedAt, true)}` : ''}
            </span>
            <Button size="sm" onClick={refresh} disabled={stats.loading || alerts.loading}>
              <RefreshCw className={cn('size-3.5', (stats.loading || alerts.loading) && 'animate-spin')} aria-hidden />
              重新整理
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" bodyClassName="py-3">
          <p className="mb-2 text-xs font-medium text-ink-2">快速調查</p>
          <AddressInput
            compact
            showSamples={false}
            submitLabel="調查"
            onSubmit={(c, a) => router.push(`/investigate?chain=${c}&address=${encodeURIComponent(a)}`)}
          />
        </Card>
        <Card className="lg:col-span-5" bodyClassName="py-3">
          <p className="mb-2 text-xs font-medium text-ink-2">系統狀態</p>
          <HealthChips health={health.data} error={health.error} loading={health.loading && !health.data} />
        </Card>
      </div>

      {stats.error && !s && (
        <ErrorBanner
          error={stats.error}
          onRetry={refresh}
          title={offline ? '後端 API 無法連線，儀表板資料暫不可用' : '無法載入統計資料'}
        />
      )}

      <section aria-label="關鍵指標" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          icon={Bell}
          label="24 小時警示數"
          value={s ? fmtInt(s.alerts24h.total) : undefined}
          loading={stats.loading && !s}
          hint={s ? CHAINS.map((c) => `${CHAIN_SHORT[c]} ${s.alerts24h.byChain?.[c] ?? 0}`).join(' · ') : undefined}
        />
        <Kpi
          icon={OctagonAlert}
          label="高 / 極高風險警示"
          value={s ? fmtInt((s.alerts24h.bySeverity?.high ?? 0) + (s.alerts24h.bySeverity?.critical ?? 0)) : undefined}
          loading={stats.loading && !s}
          hint={s ? `極高 ${s.alerts24h.bySeverity?.critical ?? 0} · 高 ${s.alerts24h.bySeverity?.high ?? 0}（24 小時）` : undefined}
          emphasis={!!s && (s.alerts24h.bySeverity?.critical ?? 0) > 0}
        />
        <Kpi
          icon={ListChecks}
          label="監控地址數"
          value={s ? fmtInt(s.watchlistCount) : undefined}
          loading={stats.loading && !s}
          hint={s ? `累計 AI 調查 ${fmtInt(s.investigations)} 次` : undefined}
          href="/watchlist"
        />
        <Kpi
          icon={Scale}
          label="OFAC 制裁名單筆數"
          value={s ? fmtInt(s.sanctions.counts.total) : undefined}
          loading={stats.loading && !s}
          hint={
            s
              ? `更新 ${s.sanctions.updatedAt ? fmtDate(Date.parse(s.sanctions.updatedAt)) : '—'} · EVM ${s.sanctions.counts.evm} / TRON ${s.sanctions.counts.tron} / BTC ${s.sanctions.counts.btc}`
              : undefined
          }
        />
        <Kpi
          icon={Clock}
          label="最近掃描時間"
          value={s ? (s.lastSweepAt ? fmtRelative(s.lastSweepAt) : '尚未執行') : undefined}
          loading={stats.loading && !s}
          hint={s?.lastSweepAt ? `${fmtDateTime(s.lastSweepAt)}（台北時間）` : s ? '排程掃描（Cron）尚未產生紀錄' : undefined}
          className="col-span-2 md:col-span-1"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className={cn('grid gap-6 self-start md:grid-cols-2 xl:col-span-8', stats.loading && s && 'opacity-80')}>
          <Card title="24 小時警示趨勢" subtitle="每小時警示數（台北時間）">
            {!s ? (
              <ChartPlaceholder loading={stats.loading} />
            ) : s.alerts24h.total === 0 ? (
              <EmptyState icon={Bell} title="過去 24 小時沒有警示" description="排程掃描或監控名單偵測到風險時，警示會出現在這裡。" compact className="h-[220px]" />
            ) : (
              <HourlyAlertsChart hourly={s.alertsHourly} />
            )}
          </Card>
          <Card title="警示嚴重度分布" subtitle="過去 24 小時，依嚴重度">
            {!s ? (
              <ChartPlaceholder loading={stats.loading} />
            ) : s.alerts24h.total === 0 ? (
              <EmptyState icon={Siren} title="尚無警示可統計" compact className="h-[220px]" />
            ) : (
              <RiskLevelBars counts={s.alerts24h.bySeverity} ariaLabel="過去 24 小時警示依嚴重度分布" />
            )}
          </Card>
          <Card title="各鏈 × 嚴重度" subtitle={`依最近 ${items.length} 筆警示中 24 小時內的 ${last24h.length} 筆統計`}>
            {!alerts.data ? (
              <ChartPlaceholder loading={alerts.loading} />
            ) : last24h.length === 0 ? (
              <EmptyState icon={Siren} title="過去 24 小時沒有警示" compact className="h-[240px]" />
            ) : (
              <ChainSeverityChart alerts={last24h} />
            )}
          </Card>
          <Card title="地址風險分布" subtitle="已調查與監控中地址的最新風險等級">
            {!s ? (
              <ChartPlaceholder loading={stats.loading} />
            ) : RISK_ORDER.every((l) => !s.riskDistribution?.[l]) ? (
              <EmptyState icon={Bot} title="尚無已評分的地址" description="完成地址調查或加入監控名單後即會統計。" compact className="h-[220px]" />
            ) : (
              <RiskLevelBars counts={s.riskDistribution} unit="個地址" ariaLabel="地址最新風險等級分布" />
            )}
          </Card>
        </div>

        <Card
          title="即時警示"
          icon={Siren}
          className="xl:col-span-4"
          subtitle="點擊警示即可調查該地址"
          bodyClassName="px-0 py-0"
          actions={
            <div className="flex gap-1.5">
              <label className="sr-only" htmlFor="feed-chain">
                鏈別篩選
              </label>
              <select
                id="feed-chain"
                value={chainFilter}
                onChange={(e) => setChainFilter(e.target.value as Chain | '')}
                className="h-8 rounded-lg border border-line-strong bg-sunken px-2 text-xs text-ink focus:border-accent focus:outline-none"
              >
                <option value="">全部鏈</option>
                {CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {CHAIN_SHORT[c]}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="feed-sev">
                嚴重度篩選
              </label>
              <select
                id="feed-sev"
                value={sevFilter}
                onChange={(e) => setSevFilter(e.target.value as Severity | '')}
                className="h-8 rounded-lg border border-line-strong bg-sunken px-2 text-xs text-ink focus:border-accent focus:outline-none"
              >
                <option value="">全部等級</option>
                {[...RISK_ORDER].reverse().map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_ZH[l]}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <AlertFeed
            alerts={feed}
            loading={alerts.loading && !alerts.data}
            error={alerts.data ? undefined : alerts.error}
            filtered={!!chainFilter || !!sevFilter}
            onRetry={alerts.reload}
          />
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  loading,
  emphasis,
  href,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  hint?: string;
  loading?: boolean;
  emphasis?: boolean;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-2">{label}</span>
        <Icon className={cn('size-4', emphasis ? 'text-risk-critical' : 'text-ink-3')} aria-hidden />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{value ?? '—'}</div>
      )}
      <div className="mt-1 min-h-4 text-[11px] leading-snug text-ink-3">{hint ?? ''}</div>
    </>
  );
  const cls = cn(
    'block min-w-0 rounded-xl border bg-surface px-4 py-3 shadow-sm shadow-black/20',
    emphasis ? 'border-risk-critical/50' : 'border-line',
    href && 'transition-colors hover:border-accent/60',
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ChartPlaceholder({ loading }: { loading: boolean }) {
  return loading ? (
    <Skeleton className="h-[220px] w-full" />
  ) : (
    <EmptyState title="資料暫不可用" description="後端 API 無回應。" compact className="h-[220px]" />
  );
}

function HealthChips({ health, error, loading }: { health?: HealthResponse; error?: ApiError; loading: boolean }) {
  if (loading) return <Skeleton className="h-7 w-full" />;
  if (!health) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag tone="danger">
          <CircleX className="size-3" aria-hidden />
          API 離線
        </Tag>
        <span className="text-ink-3">{error ? `無法取得 /api/health（${error.code}）` : ''}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHAINS.map((c) => {
        const st = health.chains?.[c];
        const ok = !!st?.available;
        return (
          <span
            key={c}
            title={`${CHAIN_ZH[c]}：${ok ? '可用' : '不可用'}${st?.source ? `｜來源 ${st.source}` : ''}${st?.note ? `｜${st.note}` : ''}`}
            className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2"
          >
            {ok ? <CircleCheck className="size-3 text-risk-low" aria-hidden /> : <CircleX className="size-3 text-risk-critical" aria-hidden />}
            <span className="font-semibold">{CHAIN_SHORT[c]}</span>
            <span className="text-ink-3">{ok ? '可用' : '不可用'}</span>
          </span>
        );
      })}
      <span
        title={health.glm.configured ? `${health.glm.model} @ ${health.glm.host}` : '未設定 GLM 金鑰，AI 報告將改用規則模板'}
        className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2"
      >
        {health.glm.configured ? <CircleCheck className="size-3 text-risk-low" aria-hidden /> : <CircleX className="size-3 text-risk-medium" aria-hidden />}
        <span className="font-semibold">GLM</span>
        <span className="text-ink-3">{health.glm.configured ? health.glm.model : '未設定'}</span>
      </span>
      <span className="text-[11px] text-ink-3">API v{health.version}</span>
    </div>
  );
}

function AlertFeed({
  alerts,
  loading,
  error,
  filtered,
  onRetry,
}: {
  alerts: Alert[];
  loading: boolean;
  error?: ApiError;
  filtered: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorBanner error={error} onRetry={onRetry} className="m-4" />;
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={filtered ? '沒有符合篩選條件的警示' : '目前沒有警示'}
        description={filtered ? undefined : '排程掃描會定期檢查監控名單與制裁相關地址，新警示將即時顯示於此。'}
        className="m-4"
      />
    );
  }
  return (
    <ul className="max-h-[680px] divide-y divide-line overflow-y-auto scroll-thin" aria-label="最新警示">
      {alerts.map((a) => (
        <li key={a.id}>
          <Link
            href={`/investigate?chain=${a.chain}&address=${encodeURIComponent(a.address)}`}
            className="block px-4 py-3 transition-colors hover:bg-raised/60 focus-visible:bg-raised/60"
          >
            <div className="flex items-center gap-2">
              <SeverityChip level={a.severity} size="xs" />
              <ChainBadge chain={a.chain} />
              <span className="ml-auto shrink-0 text-[11px] text-ink-3" title={fmtDateTime(a.createdAt)}>
                {fmtRelative(a.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm text-ink">{a.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
              <span className="font-mono text-ink-2" title={a.address}>
                {shortAddress(a.address)}
              </span>
              <span className="font-mono">{a.ruleId}</span>
              {a.usd !== undefined && a.usd !== null && <span className="tabular">{fmtUsdCompact(a.usd)}</span>}
              <span>{SOURCE_ZH[a.source] ?? a.source}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
