'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { CHAIN_ZH, type AdminClient as AdminClientRow, type AdminJobName, type AdminJobRunResponse, type AdminOverview, type Chain } from '@aml/engine';
import {
  Activity,
  Ban,
  CalendarClock,
  CircleCheck,
  CircleX,
  Gauge,
  KeyRound,
  LogOut,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader } from '@/components/ui/Card';
import { EmptyState, ErrorBanner, Notice, Skeleton, Spinner } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { adminApi, type AdminApi, toApiError } from '@/lib/api';
import { clearAdminToken, loadAdminToken, saveAdminToken } from '@/lib/adminSession';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtInt, fmtMs, fmtRelative } from '@/lib/format';

const JOB_INFO: Record<AdminJobName, { title: string; when: string; detail: string }> = {
  sweep: {
    title: '鏈上掃描',
    when: '每 10 分鐘',
    detail: 'Tornado Cash 存提款、OFAC 制裁地址（ETH / TRON 輪替）動態',
  },
  watchlist: {
    title: '監控名單重掃',
    when: '每 15 分鐘',
    detail: '每次重新分析 2 個最久未掃描的監控地址',
  },
  sanctions: {
    title: '制裁名單更新與清理',
    when: '每日 03:17 UTC',
    detail: '下載 OFAC SDN 數位貨幣地址、清除過期警示／快取／額度紀錄',
  },
};

const STAT_ZH: Record<string, string> = {
  tornado: 'Tornado 警示',
  ofacEth: 'OFAC ETH',
  ofacTron: 'OFAC TRON',
  errors: '錯誤',
  scanned: '已掃描',
  alerts: '新警示',
  sanctionsUpdated: '已更新名單',
  sanctionsFailed: '下載失敗',
};

function statsText(stats: Record<string, unknown> | null): string {
  if (!stats) return '—';
  const parts = Object.entries(stats).map(([k, v]) => {
    const value = Array.isArray(v) ? (v.length ? v.join('、') : '無') : String(v);
    return `${STAT_ZH[k] ?? k}：${value}`;
  });
  return parts.length ? parts.join('　') : '—';
}

export function AdminClient() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setToken(loadAdminToken());
    setChecked(true);
  }, []);

  if (!checked) {
    return (
      <div className="py-16 text-center">
        <Spinner label="載入中…" />
      </div>
    );
  }

  if (!token) {
    return (
      <LoginCard
        onLogin={(t) => {
          saveAdminToken(t);
          setToken(t);
        }}
      />
    );
  }

  return (
    <Dashboard
      api={adminApi(token)}
      onLogout={() => {
        clearAdminToken();
        setToken(null);
      }}
    />
  );
}

function LoginCard({ onLogin }: { onLogin: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(t).verify();
      onLogin(t);
    } catch (err) {
      const e2 = toApiError(err);
      setError(e2.code === 'FORBIDDEN' ? '權杖不正確。' : e2.message || '無法連線到後端 API。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <PageHeader title="管理後台" icon={ShieldAlert} description="輸入部署時設定的 ADMIN_TOKEN。權杖只保存在此分頁，關閉分頁即清除。" />
      <Card title="管理員登入" icon={KeyRound}>
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor={id} className="block text-xs text-ink-3">
            管理員權杖
          </label>
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 font-mono text-sm text-ink outline-none focus:border-accent"
            placeholder="ADMIN_TOKEN"
          />
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-risk-critical">
              <CircleX className="size-4" aria-hidden />
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={!value.trim() || busy} className="w-full">
            {busy ? <Spinner label="驗證中…" /> : '登入'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Dashboard({ api, onLogout }: { api: AdminApi; onLogout: () => void }) {
  const overview = useAsync((s) => api.overview(s), [api]);
  const clients = useAsync((s) => api.clients(s), [api]);
  const forbidden = toApiError(overview.error ?? clients.error ?? null).code === 'FORBIDDEN' && Boolean(overview.error ?? clients.error);
  const reloadAll = () => {
    overview.reload();
    clients.reload();
  };

  useEffect(() => {
    if (forbidden) onLogout();
  }, [forbidden, onLogout]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="管理後台"
        icon={ShieldAlert}
        description={
          overview.data ? `資料時間 ${fmtDateTime(overview.data.generatedAt, true)}（台北時間）` : '系統用量、排程任務與濫用監控。'
        }
        actions={
          <>
            <Button size="sm" onClick={reloadAll} disabled={overview.loading || clients.loading}>
              <RefreshCw className={cn('size-3.5', (overview.loading || clients.loading) && 'animate-spin')} aria-hidden />
              重新整理
            </Button>
            <Button size="sm" variant="ghost" onClick={onLogout}>
              <LogOut className="size-3.5" aria-hidden />
              登出
            </Button>
          </>
        }
      />

      {overview.error && !overview.data ? (
        <ErrorBanner error={overview.error} onRetry={overview.reload} />
      ) : !overview.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <UsageSection data={overview.data} />
          <JobsSection data={overview.data} api={api} onRan={overview.reload} />
          <ConfigSection data={overview.data} />
        </>
      )}

      <ClientsSection state={clients} api={api} onChanged={reloadAll} />
    </div>
  );
}

function Meter({ label, used, limit, hint }: { label: string; used: number; limit: number; hint?: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone = ratio >= 0.9 ? 'bg-risk-critical' : ratio >= 0.7 ? 'bg-risk-medium' : 'bg-risk-low';
  return (
    <div className="rounded-lg border border-line bg-raised/50 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-ink-2">{label}</p>
        <p className="tabular-nums text-sm text-ink">
          <span className="text-lg font-semibold">{fmtInt(used)}</span>
          <span className="text-ink-3"> / {fmtInt(limit)}</span>
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-ink-3">
        剩餘 {fmtInt(Math.max(0, limit - used))}
        {hint ? `　${hint}` : ''}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised/50 px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

function UsageSection({ data }: { data: AdminOverview }) {
  const c = data.counts;
  return (
    <Card title="系統總覽與今日用量" icon={Gauge} subtitle="額度每日 00:00 UTC（台北 08:00）重置">
      <div className="grid gap-3 md:grid-cols-2">
        <Meter label="Zerion API 請求（ETH / BSC 鏈上資料）" used={data.usage.zerion.used} limit={data.usage.zerion.limit} hint="免費方案每日 2,000 次" />
        <Meter label="GLM 呼叫（AI 調查，全站）" used={data.usage.glm.used} limit={data.usage.glm.limit} hint={`每 IP 每日 ${data.usage.agentPerIpLimit} 次`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="AI 調查（今日／累計）"
          value={`${fmtInt(c.investigationsToday)} / ${fmtInt(c.investigations)}`}
          sub={`GLM ${fmtInt(c.investigationsBySource.glm)}・模板 ${fmtInt(c.investigationsBySource.template)}`}
        />
        <Stat label="警示（24 小時／總數）" value={`${fmtInt(c.alerts24h)} / ${fmtInt(c.alerts)}`} />
        <Stat label="監控名單" value={`${fmtInt(c.watchlist)} / ${fmtInt(c.watchlistMax)}`} sub={`每 IP 每日新增 ${data.usage.watchlistPerIpLimit} 筆`} />
        <Stat
          label="OFAC 制裁名單"
          value={fmtInt(data.sanctions.counts.total)}
          sub={`更新於 ${data.sanctions.updatedAt}`}
        />
        <Stat label="有效分析快取" value={fmtInt(c.cacheEntries)} sub="每筆保留 10 分鐘" />
        <Stat label="已封鎖用戶" value={fmtInt(c.blockedClients)} />
      </div>
    </Card>
  );
}

function JobsSection({ data, api, onRan }: { data: AdminOverview; api: AdminApi; onRan: () => void }) {
  const [running, setRunning] = useState<AdminJobName | null>(null);
  const [results, setResults] = useState<Partial<Record<AdminJobName, AdminJobRunResponse | { error: string }>>>({});

  const run = async (job: AdminJobName) => {
    setRunning(job);
    try {
      const r = await api.runJob(job);
      setResults((m) => ({ ...m, [job]: r }));
      onRan();
    } catch (err) {
      setResults((m) => ({ ...m, [job]: { error: toApiError(err).message } }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card title="排程任務" icon={CalendarClock} subtitle="Cloudflare Cron Triggers；可手動立即執行（會消耗外部 API 額度）" bodyClassName="p-0">
      <div className="divide-y divide-line">
        {data.jobs.map((j) => {
          const info = JOB_INFO[j.job];
          const result = results[j.job];
          return (
            <div key={j.job} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {info.title}
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] font-normal text-ink-3">{j.schedule}</span>
                  <span className="text-xs font-normal text-ink-3">{info.when}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-3">{info.detail}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                  {j.lastRunAt === null ? (
                    <span className="text-ink-3">尚無執行紀錄</span>
                  ) : (
                    <>
                      <span className={cn('inline-flex items-center gap-1', j.ok ? 'text-risk-low' : 'text-risk-critical')}>
                        {j.ok ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleX className="size-3.5" aria-hidden />}
                        {j.ok ? '成功' : '失敗'}
                      </span>
                      <span title={fmtDateTime(j.lastRunAt, true)}>上次 {fmtRelative(j.lastRunAt)}</span>
                      {j.durationMs !== null && <span>耗時 {fmtMs(j.durationMs)}</span>}
                      <span className="break-words text-ink-3">{j.error ? `錯誤：${j.error}` : statsText(j.stats)}</span>
                    </>
                  )}
                </p>
                {result && (
                  <p
                    role="status"
                    className={cn('mt-1.5 text-xs', 'error' in result || !result.ok ? 'text-risk-critical' : 'text-accent-ink')}
                  >
                    {'error' in result
                      ? `執行失敗：${result.error}`
                      : result.ok
                        ? `剛剛手動執行完成（${fmtMs(result.durationMs)}）：${statsText(result.stats)}`
                        : `執行失敗：${result.error ?? '未知錯誤'}`}
                  </p>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={() => run(j.job)} disabled={running !== null}>
                {running === j.job ? <Spinner label="執行中…" /> : <><Play className="size-3.5" aria-hidden />立即執行</>}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ConfigSection({ data }: { data: AdminOverview }) {
  const cfg = data.config;
  const yes = (v: boolean, onText = '已設定', offText = '未設定') => (
    <span className={cn('inline-flex items-center gap-1', v ? 'text-risk-low' : 'text-ink-3')}>
      {v ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleX className="size-3.5" aria-hidden />}
      {v ? onText : offText}
    </span>
  );
  return (
    <Card title="設定與資料來源" icon={Settings2} subtitle="金鑰只顯示是否已設定，不會回傳內容">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="GLM 金鑰">{yes(cfg.glmConfigured)}</Field>
        <Field label="GLM 模型／端點">
          <span className="font-mono text-xs">{cfg.glmModel}</span>
          <span className="block font-mono text-xs text-ink-3">{cfg.glmHost}</span>
        </Field>
        <Field label="GLM 思考模式">{cfg.glmThinking === 'enabled' ? '開啟' : '關閉'}</Field>
        <Field label="Zerion 金鑰（ETH / BSC）">{yes(cfg.zerionConfigured)}</Field>
        <Field label="Blockscout PRO 金鑰">{yes(cfg.blockscoutKey, '已設定', '未設定（用公開端點）')}</Field>
        <Field label="TronGrid 金鑰">{yes(cfg.trongridKey, '已設定', '未設定（用公開額度）')}</Field>
        <Field label="CORS 允許來源" className="sm:col-span-2">
          {cfg.allowedOrigins.map((o) => (
            <span key={o} className="mr-2 inline-block font-mono text-xs">
              {o}
            </span>
          ))}
        </Field>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(data.chains) as Chain[]).map((ch) => {
          const s = data.chains[ch];
          return (
            <span
              key={ch}
              title={s.note}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                s.available ? 'border-risk-low/40 text-ink' : 'border-risk-critical/40 text-ink-2',
              )}
            >
              {s.available ? <CircleCheck className="size-3.5 text-risk-low" aria-hidden /> : <CircleX className="size-3.5 text-risk-critical" aria-hidden />}
              {CHAIN_ZH[ch]}：{s.source}
              {s.note && <span className="text-ink-3">（{s.note}）</span>}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

function ClientsSection({
  state,
  api,
  onChanged,
}: {
  state: ReturnType<typeof useAsync<import('@aml/engine').AdminClientsResponse>>;
  api: AdminApi;
  onChanged: () => void;
}) {
  const data = state.data;
  return (
    <Card
      title="濫用監控"
      icon={Activity}
      subtitle={
        data
          ? `${data.date}（UTC）・用戶以 IP 加鹽雜湊後的匿名 ID 表示，系統不保存原始 IP`
          : '今日各用戶的 AI 調查與新增監控次數'
      }
      bodyClassName="p-0"
    >
      {state.error && !data ? (
        <ErrorBanner error={state.error} onRetry={state.reload} className="m-4" />
      ) : !data ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="今日尚無用戶使用 AI 調查或新增監控" className="m-4" compact />
      ) : (
        <ClientsTable data={data} api={api} onChanged={onChanged} />
      )}
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <Notice>
          封鎖後，該匿名 ID 無法執行地址分析、AI 調查與新增監控；儀表板等唯讀頁面不受影響。重設額度會清除該 ID 今日的 AI 調查與新增監控計數。
        </Notice>
      </div>
    </Card>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 tabular-nums text-ink">
        {used}
        <span className="text-ink-3">/{limit}</span>
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div
          className={cn('h-full rounded-full', ratio >= 1 ? 'bg-risk-critical' : ratio >= 0.7 ? 'bg-risk-medium' : 'bg-accent')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function ClientsTable({
  data,
  api,
  onChanged,
}: {
  data: import('@aml/engine').AdminClientsResponse;
  api: AdminApi;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      setBlocking(null);
      setReason('');
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: toApiError(err).message });
    } finally {
      setBusy(null);
    }
  };

  const rows = useMemo(() => data.items, [data.items]);

  return (
    <div>
      {message && (
        <p role="status" className={cn('px-4 pt-3 text-sm sm:px-5', message.ok ? 'text-risk-low' : 'text-risk-critical')}>
          {message.text}
        </p>
      )}
      <div className="relative overflow-x-auto scroll-thin">
        <table className="w-full min-w-[820px] text-left text-sm">
          <caption className="sr-only">今日用戶用量</caption>
          <thead className="bg-raised text-xs text-ink-3">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">匿名 ID</th>
              <th scope="col" className="px-3 py-2 font-medium">AI 調查次數</th>
              <th scope="col" className="px-3 py-2 font-medium">今日調查紀錄</th>
              <th scope="col" className="px-3 py-2 font-medium">新增監控</th>
              <th scope="col" className="px-3 py-2 font-medium">最近調查</th>
              <th scope="col" className="px-3 py-2 font-medium">狀態</th>
              <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">動作</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c: AdminClientRow) => (
              <tr key={c.id} className={cn('border-t border-line align-middle', c.blocked && 'bg-risk-critical/5')}>
                <td className="px-4 py-2 font-mono text-xs text-ink" title={c.id}>
                  {c.id.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 text-xs">
                  <UsageBar used={c.agentRuns} limit={data.agentPerIpLimit} />
                </td>
                <td className="px-3 py-2 tabular-nums text-ink-2">{c.investigationsToday}</td>
                <td className="px-3 py-2 text-xs">
                  <UsageBar used={c.watchAdds} limit={data.watchlistPerIpLimit} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2" title={c.lastSeenAt ? fmtDateTime(c.lastSeenAt, true) : undefined}>
                  {c.lastSeenAt ? fmtRelative(c.lastSeenAt) : <span className="text-ink-3">—</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.blocked ? (
                    <span className="inline-flex items-center gap-1 text-risk-critical" title={c.blockedAt ? `封鎖於 ${fmtDateTime(c.blockedAt)}` : undefined}>
                      <Ban className="size-3.5" aria-hidden />
                      已封鎖{c.blockedReason ? `：${c.blockedReason}` : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-ink-2">
                      <ShieldCheck className="size-3.5 text-risk-low" aria-hidden />
                      正常
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {blocking === c.id ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(c.id, () => api.blockClient(c.id, reason.trim()), `已封鎖 ${c.id.slice(0, 8)}…`);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="封鎖原因"
                        value={reason}
                        maxLength={80}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="原因（選填）"
                        className="h-8 w-36 rounded-md border border-line-strong bg-sunken px-2 text-xs text-ink outline-none focus:border-accent"
                      />
                      <Button size="sm" variant="danger" type="submit" disabled={busy === c.id}>
                        確認封鎖
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setBlocking(null)}>
                        取消
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === c.id || (c.agentRuns === 0 && c.watchAdds === 0)}
                        onClick={() => act(c.id, () => api.resetClient(c.id), `已重設 ${c.id.slice(0, 8)}… 的今日額度`)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        重設額度
                      </Button>
                      {c.blocked ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === c.id}
                          onClick={() => act(c.id, () => api.unblockClient(c.id), `已解除封鎖 ${c.id.slice(0, 8)}…`)}
                        >
                          <Undo2 className="size-3.5" aria-hidden />
                          解除封鎖
                        </Button>
                      ) : (
                        <Button size="sm" variant="danger" disabled={busy === c.id} onClick={() => setBlocking(c.id)}>
                          <Ban className="size-3.5" aria-hidden />
                          封鎖
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
