'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Cpu, ExternalLink } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatRelativeTime } from '@/lib/format';

interface WorkerStatus {
  workerId: string;
  lastBeat: string;
  currentRunId?: string;
  currentPhase?: string;
  processed?: number;
  alive: boolean;
}

interface WorkerStatusResponse {
  workers: WorkerStatus[];
  aliveCount: number;
  generatedAt: string;
  error?: string;
}

interface WorkerStatusNoticeProps {
  className?: string;
  compact?: boolean;
  showHealthy?: boolean;
}

export function WorkerStatusNotice({
  className,
  compact = false,
  showHealthy = false,
}: WorkerStatusNoticeProps) {
  const [status, setStatus] = useState<WorkerStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch('/api/workers/status', { cache: 'no-store' });
      const body = (await response.json()) as WorkerStatusResponse;
      if (!cancelled) setStatus(body);
    }

    load().catch(() => undefined);
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const liveWorkers = useMemo(
    () => status?.workers.filter((worker) => worker.alive) ?? [],
    [status],
  );

  if (!status) return null;

  if (status.aliveCount > 0 && !showHealthy) return null;

  if (status.aliveCount > 0) {
    const activeRun = liveWorkers.find((worker) => worker.currentRunId);
    return (
      <Alert variant="success" className={className}>
        <Cpu className="h-4 w-4" />
        <AlertTitle>
          {status.aliveCount} worker{status.aliveCount === 1 ? '' : 's'} alive
        </AlertTitle>
        <AlertDescription>
          {activeRun ? (
            <>
              {activeRun.workerId} is on run {activeRun.currentRunId?.slice(0, 8)}
              {activeRun.currentPhase && ` · ${activeRun.currentPhase.replace(/_/g, ' ')}`}
            </>
          ) : (
            <>Last heartbeat {formatRelativeTime(liveWorkers[0]?.lastBeat ?? status.generatedAt)}.</>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning" className={className}>
      <Cpu className="h-4 w-4" />
      <AlertTitle>Queue paused: no worker heartbeat</AlertTitle>
      <AlertDescription>
        <div className={compact ? 'flex flex-wrap items-center gap-2' : undefined}>
          <span>
            Runs can be created and queued, but browser QA, patching, verification, and PR
            creation will wait until a worker checks in.
          </span>
          <Link
            href="/health"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            Health <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
