import type { RunStatus, TimelineEvent } from '@flowpr/schemas';

export interface PhaseTimings {
  phase: RunStatus | string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

export function computePhaseDurations(events: TimelineEvent[]): Map<string, PhaseTimings> {
  const map = new Map<string, PhaseTimings>();
  if (!events || events.length === 0) return map;
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  for (const event of sorted) {
    const phase = event.phase;
    const ts = new Date(event.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    const current = map.get(phase) ?? { phase };
    if (!current.startedAt || ts < new Date(current.startedAt).getTime()) {
      current.startedAt = event.createdAt;
    }
    if (!current.endedAt || ts > new Date(current.endedAt).getTime()) {
      current.endedAt = event.createdAt;
    }
    map.set(phase, current);
  }

  for (const value of map.values()) {
    if (value.startedAt && value.endedAt) {
      value.durationMs = Math.max(
        0,
        new Date(value.endedAt).getTime() -
          new Date(value.startedAt).getTime(),
      );
    }
  }

  return map;
}

export function formatDurationShort(ms?: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (minutes < 10) return `${minutes}m ${rem.toString().padStart(2, '0')}s`;
  return `${minutes}m`;
}
