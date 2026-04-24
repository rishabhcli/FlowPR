'use client';

import { useEffect, useRef, useState } from 'react';

export interface RunProgressEntry {
  id: string;
  kind: string;
  actor?: string;
  phase?: string;
  message: string;
  createdAt?: string;
  streamingUrl?: string;
  providerRunId?: string;
  extra: Record<string, string>;
}

export interface LiveStreamEntry {
  provider: string;
  providerRunId?: string;
  streamingUrl: string;
  createdAt: string;
}

export interface UseRunStreamResult {
  progress: RunProgressEntry[];
  liveStreams: LiveStreamEntry[];
  connected: boolean;
  error?: string;
}

export function useRunStream(runId: string | undefined): UseRunStreamResult {
  const [progress, setProgress] = useState<RunProgressEntry[]>([]);
  const [liveStreams, setLiveStreams] = useState<LiveStreamEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;

    setProgress([]);
    setLiveStreams([]);
    setError(undefined);

    const es = new EventSource(`/api/runs/${runId}/stream`);
    sourceRef.current = es;

    es.addEventListener('connected', () => {
      setConnected(true);
    });

    es.addEventListener('progress', (event) => {
      try {
        const raw = JSON.parse((event as MessageEvent).data) as Record<string, string> & { id: string };
        const entry: RunProgressEntry = {
          id: raw.id,
          kind: raw.kind ?? 'info',
          actor: raw.actor,
          phase: raw.phase,
          message: raw.message ?? '',
          createdAt: raw.createdAt,
          streamingUrl: raw.streamingUrl || undefined,
          providerRunId: raw.providerRunId || undefined,
          extra: raw,
        };
        setProgress((prev) => {
          if (prev.some((p) => p.id === entry.id)) return prev;
          return [...prev, entry].slice(-200);
        });
      } catch {
        // ignore malformed event
      }
    });

    es.addEventListener('liveStreams', (event) => {
      try {
        const entries = JSON.parse((event as MessageEvent).data) as LiveStreamEntry[];
        setLiveStreams(entries);
      } catch {
        // ignore
      }
    });

    es.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data === 'string' && data) {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          if (parsed.message) setError(parsed.message);
        } catch {
          // ignore
        }
      }
      setConnected(false);
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [runId]);

  return { progress, liveStreams, connected, error };
}
