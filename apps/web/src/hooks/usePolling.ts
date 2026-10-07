'use client';

import { useEffect, useRef } from 'react';

/**
 * Call `tick` every `intervalMs` while the tab is visible. Polling pauses when
 * `document.hidden`; on return to the tab it ticks immediately if a beat was missed.
 * (The initial load is the caller's job.)
 */
export function usePolling(tick: () => void, intervalMs: number, enabled = true): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let last = Date.now();
    const fire = () => {
      last = Date.now();
      tickRef.current();
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) fire();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= intervalMs) fire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
