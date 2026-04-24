'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Radio } from 'lucide-react';
import type { TimelineEvent } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatTime, truncate } from '@/lib/format';
import { statusToTone, toneDotClass } from '@/lib/state-tone';

interface ActivityEntry extends TimelineEvent {
  flowGoal: string;
  repo: string;
  runStatus: string;
}

interface ActivityFeedResponse {
  entries: ActivityEntry[];
  generatedAt: string;
  error?: string;
}

interface ActivityFeedProps {
  className?: string;
  intervalMs?: number;
  height?: number;
  title?: string;
  subtitle?: string;
  filterRunId?: string;
}

export function ActivityFeed({
  className,
  intervalMs = 7000,
  height = 360,
  title = 'System activity',
  subtitle = 'Live tail of every run on the workspace.',
  filterRunId,
}: ActivityFeedProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string>();
  const [generatedAt, setGeneratedAt] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/observability/activity?limit=40', {
          cache: 'no-store',
        });
        const body = (await response.json()) as ActivityFeedResponse;
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? `Status ${response.status}`);
          return;
        }
        setEntries(body.entries ?? []);
        setGeneratedAt(body.generatedAt);
        setError(undefined);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    load();
    const interval = window.setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  const visible = filterRunId
    ? entries.filter((entry) => entry.runId === filterRunId)
    : entries;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            {title}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
            error
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-success/40 bg-success/10 text-success',
          )}
          title={generatedAt ? `Updated ${formatTime(generatedAt)}` : undefined}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              error ? 'bg-warning' : 'animate-pulse bg-success',
            )}
          />
          {error ? 'stale' : 'live'}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="px-4 pb-4" style={{ height }}>
          {visible.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">
              <Radio className="mr-2 h-3.5 w-3.5" /> Waiting for activity…
            </div>
          ) : (
            <ul className="space-y-1.5 pt-2">
              {visible.map((entry) => (
                <li key={`${entry.runId}-${entry.id}`}>
                  <Link
                    href={`/runs/${entry.runId}`}
                    className="group flex items-start gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 transition hover:border-primary/40 hover:bg-card/60"
                  >
                    <span
                      className={cn(
                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                        toneDotClass(statusToTone(entry.status)),
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">
                        {entry.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{entry.actor}</span>
                        <span>· {entry.phase.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground/60">
                          · {truncate(entry.flowGoal, 28)}
                        </span>
                        {entry.createdAt && (
                          <span className="ml-auto font-mono text-muted-foreground/70">
                            {formatTime(entry.createdAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
