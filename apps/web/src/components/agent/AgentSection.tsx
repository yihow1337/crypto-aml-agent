'use client';

import { useEffect } from 'react';
import { CHAIN_ZH, shortAddress, type AnalyzeResponse, type AnomalyResult, type HealthResponse } from '@aml/engine';
import { Bot, FileText, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorBanner, Notice, Spinner } from '@/components/ui/feedback';
import { useAgentStream } from '@/hooks/useAgentStream';
import { targetKey, type AnalysisTarget } from '@/hooks/useAnalysis';
import { TOOL_ZH, type InvestigationExport } from '@/lib/agent';
import { CHAIN_SHORT } from '@/lib/theme';
import { AgentTracePanel } from './AgentTracePanel';
import { ReportView } from './ReportView';

export function AgentSection({
  target,
  analysis,
  anomaly,
  glm,
}: {
  target: AnalysisTarget;
  analysis: AnalyzeResponse;
  anomaly: AnomalyResult | null;
  glm?: HealthResponse['glm'];
}) {
  const agent = useAgentStream();
  const key = targetKey(target);
  const { reset } = agent;

  useEffect(() => {
    reset();
  }, [key, reset]);

  const run = () =>
    agent.start(
      target.kind === 'live' ? { chain: target.chain, address: target.address } : { scenarioId: target.id },
    );

  const running = agent.state === 'running';
  const report = agent.view.report;
  const subject = analysis.subject;
  const subjectLine = `${CHAIN_ZH[subject.chain]} ${subject.address}${analysis.mode === 'scenario' ? '（情境模擬）' : ''}`;

  const buildExport = (): InvestigationExport => ({
    exportedAt: new Date().toISOString(),
    subject,
    scenarioId: target.kind === 'scenario' ? target.id : undefined,
    score: analysis.score,
    level: analysis.level,
    hits: analysis.hits.map((h) => ({ id: h.id, title: h.title, severity: h.severity })),
    report: report ? { markdown: report.markdown, source: report.source, model: report.model } : null,
    investigationId: agent.view.done?.investigationId ?? null,
    analysis,
    anomaly: anomaly
      ? { insufficient: anomaly.insufficient, threshold: anomaly.threshold, flagged: anomaly.flagged }
      : null,
    trace: agent.events,
  });

  return (
    <Card
      id="agent"
      title="AI Agent 調查"
      icon={Bot}
      subtitle="GLM Agent 透過工具呼叫查證鏈上資料並撰寫調查報告；風險分數由程式計算，LLM 不得更改。"
      actions={
        <>
          {running && (
            <Button size="sm" variant="danger" onClick={agent.abort}>
              <Square className="size-3.5" aria-hidden />
              停止
            </Button>
          )}
          {(agent.state === 'done' || agent.state === 'error' || agent.state === 'aborted') && (
            <Button size="sm" onClick={run}>
              <RotateCcw className="size-3.5" aria-hidden />
              重新調查
            </Button>
          )}
        </>
      }
    >
      {agent.state === 'idle' ? (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <p className="text-sm text-ink-2">
              Agent 會依序呼叫下列工具蒐集證據，再由 LLM 撰寫中文調查報告（含評分卡、規則命中、資金流向與處置建議）。所有工具呼叫與耗時皆即時顯示。
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(TOOL_ZH).map(([name, zh]) => (
                <li key={name} className="flex items-center gap-2 rounded-md border border-line bg-sunken px-2.5 py-1.5 text-xs">
                  <span className="text-ink">{zh}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink-3">{name}</span>
                </li>
              ))}
            </ul>
            {glm && !glm.configured && (
              <Notice tone="warn">後端未設定 GLM 金鑰，將以規則模板產生報告（仍包含完整評分卡與證據）。</Notice>
            )}
          </div>
          <div className="flex flex-col items-start justify-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4 lg:col-span-5">
            <p className="text-sm text-ink">
              調查對象：
              <span className="font-mono">
                {CHAIN_SHORT[subject.chain]} {shortAddress(subject.address, 8, 6)}
              </span>
            </p>
            <Button variant="primary" onClick={run}>
              <Play className="size-4" aria-hidden />
              啟動 AI Agent 調查
            </Button>
            <p className="text-xs text-ink-3">通常需要 10–60 秒，視 LLM 與鏈上資料來源回應速度而定。</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">執行軌跡</h3>
            <AgentTracePanel view={agent.view} running={running} startedAt={agent.startedAt} />
          </div>
          <div className="min-w-0 lg:col-span-7">
            <h3 className="mb-3 text-sm font-semibold text-ink">調查報告</h3>
            {agent.fatal && <ErrorBanner error={agent.fatal} onRetry={run} className="mb-4" title="AI Agent 調查失敗" />}
            {agent.state === 'aborted' && !report && <Notice className="mb-4">已停止調查。可按「重新調查」再次執行。</Notice>}
            {report ? (
              <ReportView
                markdown={report.markdown}
                source={report.source}
                model={report.model}
                guard={report.guard}
                investigationId={agent.view.done?.investigationId}
                subjectLine={subjectLine}
                filenameBase={`aml-report-${subject.chain}-${subject.address.slice(0, 10)}`}
                buildExport={buildExport}
              />
            ) : running ? (
              <EmptyState icon={Bot} title="報告產生中…" description="Agent 完成工具呼叫後會撰寫報告；分數卡將由程式自動置於報告開頭。">
                <Spinner label="Agent 執行中" />
              </EmptyState>
            ) : (
              !agent.fatal && <EmptyState icon={FileText} title="尚未產生報告" />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
