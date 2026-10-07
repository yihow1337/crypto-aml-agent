'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, InvestigateRequest } from '@aml/engine';
import { buildAgentView, type AgentView } from '@/lib/agent';
import { API_BASE, ApiError, errorFromResponse, isAbort, toApiError } from '@/lib/api';
import { readSseStream, toAgentEvent } from '@/lib/sse';

export type AgentRunState = 'idle' | 'running' | 'done' | 'error' | 'aborted';

/** Time allowed for the response headers, and max silence once streaming (server pings every 15 s). */
const CONNECT_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 45_000;

export interface AgentStream {
  state: AgentRunState;
  events: AgentEvent[];
  view: AgentView;
  /** Fatal (non-recoverable) failure: HTTP error before streaming, or a broken stream. */
  fatal: ApiError | null;
  startedAt: number | null;
  start: (req: InvestigateRequest) => void;
  abort: () => void;
  reset: () => void;
}

/**
 * POST /api/agent/investigate and consume the SSE response with fetch + ReadableStream
 * (EventSource cannot POST). Aborts automatically on unmount.
 */
export function useAgentStream(): AgentStream {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<AgentRunState>('idle');
  const [fatal, setFatal] = useState<ApiError | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    if (ctrlRef.current && !ctrlRef.current.signal.aborted) {
      ctrlRef.current.abort();
      setState((s) => (s === 'running' ? 'aborted' : s));
    }
  }, []);

  const reset = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setEvents([]);
    setFatal(null);
    setStartedAt(null);
    setState('idle');
  }, []);

  const start = useCallback((req: InvestigateRequest) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setEvents([]);
    setFatal(null);
    setStartedAt(Date.now());
    setState('running');

    void (async () => {
      let sawDone = false;
      let sawReport = false;
      let lastFatal: AgentEvent | null = null;
      try {
        let res: Response;
        // The connect timeout only guards the headers; the body is governed by the idle watchdog.
        const connect = new AbortController();
        const connectTimer = setTimeout(() => connect.abort(new DOMException('connect timeout', 'TimeoutError')), CONNECT_TIMEOUT_MS);
        const onUserAbort = () => connect.abort(ctrl.signal.reason);
        ctrl.signal.addEventListener('abort', onUserAbort, { once: true });
        try {
          res = await fetch(`${API_BASE}/api/agent/investigate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(req),
            signal: connect.signal,
            cache: 'no-store',
          });
        } catch (err) {
          throw toApiError(err);
        } finally {
          clearTimeout(connectTimer);
        }
        if (!res.ok) throw await errorFromResponse(res);
        if (!res.body) throw new ApiError('STREAM_ERROR', '回應沒有內容');

        await readSseStream(
          res.body,
          (msg) => {
            const ev = toAgentEvent(msg);
            if (!ev || ctrl.signal.aborted) return;
            if (ev.type === 'done') sawDone = true;
            if (ev.type === 'report') sawReport = true;
            if (ev.type === 'error' && !ev.recoverable) lastFatal = ev;
            setEvents((prev) => [...prev, ev]);
          },
          ctrl.signal,
          IDLE_TIMEOUT_MS,
        );
        if (ctrl.signal.aborted) return;
        if (sawDone || sawReport) {
          setState('done');
        } else {
          const f = lastFatal as Extract<AgentEvent, { type: 'error' }> | null;
          setFatal(
            f
              ? new ApiError('STREAM_ERROR', `${f.code}: ${f.message}`)
              : new ApiError('STREAM_ERROR', '串流在完成前結束，未收到調查報告。'),
          );
          setState('error');
        }
      } catch (err) {
        if (ctrl.signal.aborted || isAbort(err)) {
          setState('aborted');
          return;
        }
        setFatal(toApiError(err));
        setState('error');
      }
    })();
  }, []);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const view = useMemo(() => buildAgentView(events), [events]);
  return { state, events, view, fatal, startedAt, start, abort, reset };
}
