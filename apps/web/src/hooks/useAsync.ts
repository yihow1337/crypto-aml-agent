'use client';

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiError, isAbort, toApiError } from '@/lib/api';

export interface AsyncState<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
  /** Epoch ms of the last successful load. */
  updatedAt?: number;
  /** Re-run; keeps the previous data on screen while loading ("refetch keeps the frame"). */
  reload: () => void;
}

/**
 * Run an abortable async loader whenever `deps` change. Aborts in-flight requests on change
 * and on unmount; errors are normalised to ApiError.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  enabled = true,
): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({ loading: enabled });
  const loaderRef = useRef(loader);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const run = useCallback((keep: boolean) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState((s) => ({
      data: keep ? s.data : undefined,
      error: keep ? s.error : undefined,
      loading: true,
      updatedAt: s.updatedAt,
    }));
    loaderRef.current(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        setState({ data, loading: false, updatedAt: Date.now() });
      },
      (err: unknown) => {
        if (ctrl.signal.aborted || isAbort(err)) return;
        setState((s) => ({
          data: keep ? s.data : undefined,
          error: toApiError(err),
          loading: false,
          updatedAt: s.updatedAt,
        }));
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      ctrlRef.current?.abort();
      setState({ loading: false });
      return;
    }
    run(false);
    return () => ctrlRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, run]);

  const reload = useCallback(() => run(true), [run]);
  return { ...state, reload };
}
