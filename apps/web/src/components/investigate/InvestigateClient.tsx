'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CHAINS,
  detectChains,
  isValidAddress,
  LEVEL_ZH,
  SCENARIOS,
  type AnalyzeResponse,
  type Chain,
  type GraphNode,
  type HealthResponse,
} from '@aml/engine';
import {
  Activity,
  ChartColumn,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  ListChecks,
  Network,
  ScanSearch,
  Table2,
  Users,
} from 'lucide-react';
import { AgentSection } from '@/components/agent/AgentSection';
import { CounterpartyGraph } from '@/components/charts/CounterpartyGraph';
import { FlowTimeline } from '@/components/charts/FlowTimeline';
import { RiskGauge } from '@/components/charts/RiskGauge';
import { Card, PageHeader } from '@/components/ui/Card';
import { SeverityChip } from '@/components/ui/badges';
import { EmptyState, ErrorBanner, Notice, Skeleton } from '@/components/ui/feedback';
import { useAnalysis, type AnalysisTarget } from '@/hooks/useAnalysis';
import { useAsync } from '@/hooks/useAsync';
import { useIsolationForest } from '@/hooks/useIsolationForest';
import { buildLookups, scoreRange } from '@/lib/analysis';
import { api } from '@/lib/api';
import { AddressInput } from './AddressInput';
import { AnomalyPanel } from './AnomalyPanel';
import { CounterpartyTable } from './CounterpartyTable';
import { DataQualityPanel } from './DataQualityPanel';
import { RuleHitList } from './RuleHitList';
import { ScenarioBanner } from './ScenarioBanner';
import { ScoreBreakdown } from './ScoreBreakdown';
import { SubjectHeader } from './SubjectHeader';
import { TxTable } from './TxTable';

type Resolved = { target: AnalysisTarget | null; invalid?: string };

function isChain(v: string | null): v is Chain {
  return v !== null && (CHAINS as string[]).includes(v);
}

function resolveTarget(scenario: string | null, chain: string | null, address: string | null): Resolved {
  if (scenario) {
    if (!/^s\d{1,2}$/.test(scenario)) return { target: null, invalid: `找不到情境「${scenario}」。` };
    return { target: { kind: 'scenario', id: scenario } };
  }
  const a = address?.trim();
  if (!a) return { target: null };
  if (chain) {
    if (!isChain(chain)) return { target: null, invalid: `不支援的鏈別「${chain}」，請使用 eth / bsc / tron / btc。` };
    if (!isValidAddress(chain, a)) return { target: null, invalid: '地址格式無效，或與所選鏈別不符。' };
    return { target: { kind: 'live', chain, address: a } };
  }
  const candidates = detectChains(a);
  if (candidates.length === 0) return { target: null, invalid: '無法辨識的地址格式。' };
  return { target: { kind: 'live', chain: candidates[0], address: a } };
}

const SECTIONS = [
  { id: 'overview', label: '風險總覽' },
  { id: 'rules', label: '規則命中' },
  { id: 'txs', label: '交易明細' },
  { id: 'anomaly', label: 'ML 異常' },
  { id: 'graph', label: '關聯圖' },
  { id: 'flow', label: '資金流' },
  { id: 'counterparties', label: '交易對手' },
  { id: 'quality', label: '資料品質' },
  { id: 'agent', label: 'AI 調查' },
];

export function InvestigateClient() {
  const params = useSearchParams();
  const router = useRouter();
  const scenarioParam = params.get('scenario');
  const chainParam = params.get('chain');
  const addressParam = params.get('address');

  const { target, invalid } = useMemo(
    () => resolveTarget(scenarioParam, chainParam, addressParam),
    [scenarioParam, chainParam, addressParam],
  );

  const health = useAsync((s) => api.health(s), []);
  const unavailable = useMemo(() => {
    const out: Partial<Record<Chain, boolean>> = {};
    for (const c of CHAINS) if (health.data?.chains?.[c] && !health.data.chains[c].available) out[c] = true;
    return out;
  }, [health.data]);

  const analysis = useAnalysis(target);
  const scenarioMeta =
    target?.kind === 'scenario'
      ? (analysis.data?.scenario ?? SCENARIOS.find((s) => s.id === target.id))
      : undefined;

  const go = useCallback(
    (chain: Chain, address: string) => router.push(`/investigate?chain=${chain}&address=${encodeURIComponent(address)}`),
    [router],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="地址調查"
        icon={ScanSearch}
        description="輸入地址後，系統會抓取鏈上交易、套用 21 條 AML 規則與 OFAC 制裁篩查計算風險分數，並在瀏覽器端以 Isolation Forest 偵測異常交易；可再啟動 AI Agent 產生調查報告。"
      />

      <Card bodyClassName="py-4">
        <AddressInput
          key={`${addressParam ?? ''}|${chainParam ?? ''}`}
          initialAddress={target?.kind === 'live' ? target.address : (addressParam ?? '')}
          initialChain={target?.kind === 'live' ? target.chain : null}
          onSubmit={go}
          busy={analysis.loading && target?.kind === 'live'}
          unavailable={unavailable}
        />
        <p className="mt-3 border-t border-line/70 pt-3 text-xs text-ink-3">
          想看各種洗錢手法的示範？前往{' '}
          <Link href="/scenarios" className="text-accent-ink underline underline-offset-2">
            洗錢情境
          </Link>{' '}
          選擇 10 個合成案例之一。
        </p>
      </Card>

      {invalid && (
        <Notice tone="warn">
          {invalid}
          請確認網址參數，或在上方重新輸入地址。
        </Notice>
      )}

      {scenarioMeta && <ScenarioBanner meta={scenarioMeta} actual={analysis.data?.level} />}

      {!target && !invalid && <Intro />}

      {target && analysis.error && !analysis.data && (
        <ErrorBanner error={analysis.error} onRetry={analysis.reload} title="分析失敗" />
      )}

      {target && analysis.loading && !analysis.data && <ResultsSkeleton />}

      {target && analysis.data && (
        <Results
          data={analysis.data}
          target={target}
          reload={analysis.reload}
          reloading={analysis.loading}
          refreshError={analysis.error}
          glm={health.data?.glm}
          onInvestigate={go}
        />
      )}
    </div>
  );
}

function Results({
  data,
  target,
  reload,
  reloading,
  refreshError,
  glm,
  onInvestigate,
}: {
  data: AnalyzeResponse;
  target: AnalysisTarget;
  reload: () => void;
  reloading: boolean;
  refreshError?: unknown;
  glm?: HealthResponse['glm'];
  onInvestigate: (chain: Chain, address: string) => void;
}) {
  const live = data.mode === 'live';
  const chain = data.subject.chain;
  const lookups = useMemo(() => buildLookups(data), [data]);
  const forest = useIsolationForest(data);
  const range = useMemo(() => scoreRange(forest.result), [forest.result]);
  const [focus, setFocus] = useState<{ hash: string; nonce: number } | null>(null);
  const pick = useCallback((hash: string) => setFocus({ hash, nonce: Date.now() }), []);
  const onNode = useCallback((n: GraphNode) => onInvestigate(chain, n.id), [onInvestigate, chain]);
  const topSeverity = data.hits.reduce<null | (typeof data.hits)[number]['severity']>((best, h) => {
    const order = ['low', 'medium', 'high', 'critical'];
    return best === null || order.indexOf(h.severity) > order.indexOf(best) ? h.severity : best;
  }, null);

  return (
    <div className={reloading ? 'space-y-6 opacity-70 transition-opacity' : 'space-y-6 transition-opacity'}>
      <nav aria-label="結果區段" className="no-print relative z-30 -mx-4 overflow-x-auto bg-page/90 px-4 py-2 backdrop-blur scroll-thin sm:-mx-6 sm:px-6 lg:sticky lg:top-[61px]">
        <ul className="flex min-w-max gap-1.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 hover:border-accent/60 hover:text-ink">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {refreshError !== undefined && <ErrorBanner error={refreshError} onRetry={reload} title="重新分析失敗，以下為先前結果" />}

      <SubjectHeader data={data} onReload={live ? reload : undefined} reloading={reloading} />

      <div className="grid gap-6 lg:grid-cols-12">
        <Card id="overview" title="風險分數" icon={Gauge} className="lg:col-span-4" subtitle="0–100；低 <25、中 <50、高 <75、極高 ≥75">
          <RiskGauge score={data.score} level={data.level} />
          <div className="mt-1 flex flex-col items-center gap-2 text-center">
            <SeverityChip level={data.level} suffix="風險" size="md" />
            <p className="text-xs text-ink-3">
              觸發 {data.hits.length} 條規則
              {topSeverity ? `，最高嚴重度：${LEVEL_ZH[topSeverity]}` : ''}
            </p>
          </div>
        </Card>
        <Card title="分數組成" icon={ChartColumn} className="lg:col-span-8" subtitle="S = 100·[1 − (1 − S_rules/100)(1 − 0.1·A)]，再套用嚴重度下限">
          <ScoreBreakdown data={data} />
        </Card>
      </div>

      <Card id="rules" title="規則命中" icon={ListChecks} subtitle={`共 ${data.hits.length} 條規則命中；依貢獻度排序，展開可檢視證據`}>
        <RuleHitList hits={data.hits} chain={chain} linkable={live} labelOf={lookups.labelOf} />
      </Card>

      <Card id="txs" title="交易明細" icon={Table2} subtitle="時間為台北時間（UTC+8）；可排序、篩選與匯出 CSV">
        <TxTable txs={data.txs} chain={chain} linkable={live} anomaly={forest.result} range={range} lookups={lookups} focus={focus} />
      </Card>

      <Card id="anomaly" title="ML 異常偵測（Isolation Forest）" icon={Cpu} subtitle="12 維交易特徵 · 100 棵樹 · 分數 s > 0.6 或前 5% 標記為異常；點選資料點可在交易明細中定位">
        <AnomalyPanel txs={data.txs} forest={forest} range={range} labelOf={lookups.labelOf} onPick={pick} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card
          id="graph"
          title="交易對手關聯圖"
          icon={Network}
          className="lg:col-span-7"
          subtitle={live ? '節點大小 ∝ 往來金額，顏色 = 風險等級；可拖曳、縮放，點擊節點調查該地址' : '節點大小 ∝ 往來金額，顏色 = 風險等級；可拖曳、縮放'}
        >
          {data.graph.nodes.length > 1 ? (
            <CounterpartyGraph
              nodes={data.graph.nodes}
              edges={data.graph.edges}
              subjectId={data.subject.address}
              onNodeClick={live ? onNode : undefined}
            />
          ) : (
            <EmptyState icon={Network} title="沒有可繪製的交易對手" />
          )}
        </Card>
        <Card id="flow" title="每日資金流" icon={Activity} className="lg:col-span-5" subtitle="流入在上、流出在下（美元，日期以 UTC 計）">
          {data.timeline.length > 0 ? (
            <FlowTimeline timeline={data.timeline} height={400} />
          ) : (
            <EmptyState icon={Activity} title="沒有資金流資料" />
          )}
        </Card>
      </div>

      <Card id="counterparties" title="主要交易對手（前 20 名）" icon={Users} subtitle="依往來總額排序；風險係數 0–1 來自標籤類別與 1 跳曝險">
        <CounterpartyTable counterparties={data.counterparties} chain={chain} linkable={live} />
      </Card>

      <Card id="quality" title="資料品質與來源" icon={Database}>
        <DataQualityPanel data={data} />
      </Card>

      <AgentSection target={target} analysis={data} anomaly={forest.result} glm={glm} />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="分析中">
      <div className="rounded-xl border border-line bg-surface p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-6 w-full max-w-xl" />
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-72 lg:col-span-4" />
        <Skeleton className="h-72 lg:col-span-8" />
      </div>
      <Skeleton className="h-64" />
      <p className="text-center text-xs text-ink-3">正在抓取鏈上資料並執行規則分析，可能需要數秒…</p>
    </div>
  );
}

function Intro() {
  const items = [
    { icon: Gauge, title: '風險評分', text: '21 條 AML 規則 + 統計異常加成，0–100 分與四級風險。' },
    { icon: ListChecks, title: '規則證據', text: '每條命中規則附交易雜湊、地址與金額證據。' },
    { icon: Cpu, title: 'ML 異常偵測', text: '瀏覽器端 Isolation Forest，找出行為異常的單筆交易。' },
    { icon: Network, title: '關聯圖與資金流', text: '交易對手網路、每日流入流出與主要對手排行。' },
    { icon: FlaskConical, title: 'AI Agent 報告', text: 'GLM 透過工具查證後撰寫中文調查報告，可下載與列印。' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="rounded-xl border border-line bg-surface p-4">
          <Icon className="size-5 text-accent-ink" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-xs text-ink-3">{text}</p>
        </div>
      ))}
    </div>
  );
}
