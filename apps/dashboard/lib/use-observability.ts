'use client';

import { useEffect, useRef, useState } from 'react';

export interface ObservabilitySummary {
  generatedAt: string;
  runs: {
    active: number;
    queued: number;
    done24h: number;
    failed24h: number;
    total24h: number;
    successRate24h: number | null;
    meanDurationMs: number | null;
    lastRun: {
      id: string;
      status: string;
      flowGoal: string;
      updatedAt: string;
    } | null;
    error?: string;
  };
  workers: {
    alive: number;
    total: number;
    activeRunId?: string;
    activePhase?: string;
  };
  deadLetter: {
    count: number;
    mostRecentRunId?: string;
  };
  redisError?: string;
}

interface Options {
  intervalMs?: number;
  enabled?: boolean;
}

export function useObservabilitySummary({
  intervalMs = 10000,
  enabled = true,
}: Options = {}): {
  data: ObservabilitySummary | null;
  error?: string;
  loading: boolean;
} {
  const [data, setData] = useState<ObservabilitySummary | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;

    async function load() {
      try {
        const response = await fetch('/api/observability/summary', {
          cache: 'no-store',
        });
        const body = (await response.json()) as ObservabilitySummary & {
          error?: string;
        };
        if (cancelledRef.current) return;
        if (!response.ok) {
          setError(body.error ?? `Status ${response.status}`);
        } else {
          setData(body);
          setError(undefined);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    }

    load();
    const interval = window.setInterval(load, intervalMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
    };
  }, [intervalMs, enabled]);

  return { data, error, loading };
}
