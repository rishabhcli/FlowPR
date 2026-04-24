import { Camera, Clock, Film, GitBranch } from 'lucide-react';
import type { RunDetail } from '@flowpr/schemas';

import { MetricTile } from '@/components/flowpr/metric-tile';
import { cn } from '@/lib/utils';

interface ResourceTilesProps {
  detail: RunDetail;
  className?: string;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem.toString().padStart(2, '0')}s`;
}

export function ResourceTiles({ detail, className }: ResourceTilesProps) {
  const { run, browserObservations, providerArtifacts } = detail;
  const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : undefined;
  const endedAt = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const durationMs = startedAt ? endedAt - startedAt : 0;

  const tinyfishRuns = browserObservations.filter((o) => o.provider === 'tinyfish').length;
  const screenshots = browserObservations.filter((o) => o.screenshotKey || o.screenshotUrl).length;
  const artifactCount = providerArtifacts.length;

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>
      <MetricTile
        label="Run duration"
        value={formatDuration(durationMs)}
        tone="info"
        icon={<Clock className="h-4 w-4" />}
        caption={run.completedAt ? 'wall-clock, end-to-end' : 'running…'}
      />
      <MetricTile
        label="TinyFish runs"
        value={tinyfishRuns}
        tone={tinyfishRuns > 0 ? 'success' : 'muted'}
        icon={<Film className="h-4 w-4" />}
        caption={tinyfishRuns > 0 ? 'billable browser minutes' : 'no billable runs yet'}
      />
      <MetricTile
        label="Screenshots"
        value={screenshots}
        tone="info"
        icon={<Camera className="h-4 w-4" />}
        caption="stored in InsForge"
      />
      <MetricTile
        label="Artifacts recorded"
        value={artifactCount}
        tone="info"
        icon={<GitBranch className="h-4 w-4" />}
        caption="across all providers"
      />
    </div>
  );
}
