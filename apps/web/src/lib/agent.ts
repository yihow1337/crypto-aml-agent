import type { AgentEvent, Chain, RiskLevel, Severity } from '@aml/engine';

export const TOOL_ZH: Record<string, string> = {
  get_address_profile: '取得地址概況',
  get_transactions: '取得交易紀錄',
  run_aml_analysis: '執行 AML 規則分析',
  screen_sanctions: '制裁名單篩查',
  trace_counterparties: '追蹤交易對手',
};

export function toolZh(name: string): string {
  return TOOL_ZH[name] ?? name;
}

export const PHASE_ZH: Record<string, string> = {
  fetching: '抓取鏈上資料',
  analyzing: '規則分析',
  llm: 'LLM 推理',
  reporting: '產生報告',
};

export type ReportEvent = Extract<AgentEvent, { type: 'report' }>;
export type AnalysisEvent = Extract<AgentEvent, { type: 'analysis' }>;
export type BudgetEvent = Extract<AgentEvent, { type: 'budget' }>;
export type DoneEvent = Extract<AgentEvent, { type: 'done' }>;
export type ErrorEvent = Extract<AgentEvent, { type: 'error' }>;

export interface AgentStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  turn: number;
  result?: { ok: boolean; summary: string; ms: number };
}

export type TraceItem =
  | { kind: 'status'; key: string; phase: string; message: string }
  | { kind: 'step'; key: string; step: AgentStep }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'error'; key: string; code: string; message: string; recoverable: boolean };

export interface AgentView {
  items: TraceItem[];
  steps: AgentStep[];
  phase?: string;
  analysis?: AnalysisEvent;
  budget?: BudgetEvent;
  report?: ReportEvent;
  errors: ErrorEvent[];
  done?: DoneEvent;
}

/** Fold the agent event log into a display model (pairs tool_call with tool_result by id). */
export function buildAgentView(events: readonly AgentEvent[]): AgentView {
  const view: AgentView = { items: [], steps: [], errors: [] };
  const byId = new Map<string, AgentStep>();
  events.forEach((ev, i) => {
    const key = `${ev.type}-${i}`;
    switch (ev.type) {
      case 'status':
        view.phase = ev.phase;
        view.items.push({ kind: 'status', key, phase: ev.phase, message: ev.message });
        break;
      case 'tool_call': {
        const step: AgentStep = { id: ev.id, name: ev.name, args: ev.args ?? {}, turn: ev.turn };
        byId.set(ev.id, step);
        view.steps.push(step);
        view.items.push({ kind: 'step', key, step });
        break;
      }
      case 'tool_result': {
        let step = byId.get(ev.id);
        if (!step) {
          // Result without a matching call: still show it.
          step = { id: ev.id, name: ev.name, args: {}, turn: 0 };
          byId.set(ev.id, step);
          view.steps.push(step);
          view.items.push({ kind: 'step', key, step });
        }
        step.result = { ok: ev.ok, summary: ev.summary, ms: ev.ms };
        break;
      }
      case 'analysis':
        view.analysis = ev;
        break;
      case 'thinking':
        if (ev.text?.trim()) view.items.push({ kind: 'thinking', key, text: ev.text });
        break;
      case 'budget':
        view.budget = ev;
        break;
      case 'report':
        view.report = ev;
        break;
      case 'error':
        view.errors.push(ev);
        view.items.push({ kind: 'error', key, code: ev.code, message: ev.message, recoverable: ev.recoverable });
        break;
      case 'done':
        view.done = ev;
        break;
    }
  });
  return view;
}

/** Shape used when exporting an investigation as JSON. */
export interface InvestigationExport {
  exportedAt: string;
  subject: { chain: Chain; address: string } | null;
  scenarioId?: string;
  score?: number;
  level?: RiskLevel;
  hits?: { id: string; title: string; severity: Severity }[];
  report: { markdown: string; source: 'glm' | 'template'; model?: string } | null;
  investigationId?: string | null;
  analysis?: unknown;
  anomaly?: unknown;
  trace?: AgentEvent[];
}
