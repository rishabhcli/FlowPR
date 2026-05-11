'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Database,
  Factory,
  Github,
  Info,
  Package,
  ScrollText,
  Sparkles,
  User,
  Waypoints,
  Wrench,
} from 'lucide-react';
import { normalizeRunOutcomeCopy, type TimelineActor, type TimelineEvent } from '@flowpr/schemas';

import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { statusToTone, toneTextClass, toneDotClass } from '@/lib/state-tone';

const actorIcon: Record<TimelineActor, typeof Activity> = {
  user: User,
  system: Activity,
  worker: Factory,
  agent: Bot,
  insforge: Database,
  github: Github,
  redis: Package,
  tinyfish: Sparkles,
  senso: BookOpen,
  guildai: ScrollText,
  shipables: Wrench,
  akash: Waypoints,
  wundergraph: Waypoints,
  playwright: Activity,
};

interface TimelineProps {
  events: TimelineEvent[];
  variant?: 'full' | 'compact';
  className?: string;
  emptyLabel?: string;
}

export function Timeline({
  events,
  variant = 'full',
  className,
  emptyLabel = 'No activity yet.',
}: TimelineProps) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => b.sequence - a.sequence),
    [events],
  );

  if (sorted.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground', className)}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <ol className={cn('relative space-y-3', className)}>
      {sorted.map((event) => (
        <TimelineRow key={event.id} event={event} compact={variant === 'compact'} />
      ))}
    </ol>
  );
}

function TimelineRow({ event, compact }: { event: TimelineEvent; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = actorIcon[event.actor] ?? Activity;
  const tone = statusToTone(event.status);
  const hasDetail = Boolean(event.detail) || Object.keys(event.data ?? {}).length > 0;
  const title = normalizeRunOutcomeCopy(event.title);
  const detail = event.detail ? normalizeRunOutcomeCopy(event.detail) : undefined;

  return (
    <li className="animate-fade-in">
      <div className="flex gap-3">
        <div className="relative flex flex-col items-center">
          <div
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card',
              tone === 'success' && 'border-success/50 text-success',
              tone === 'warning' && 'border-warning/50 text-warning',
              tone === 'danger' && 'border-destructive/50 text-destructive',
              tone === 'info' && 'border-primary/50 text-primary',
              tone === 'muted' && 'border-border text-muted-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="min-w-0 flex-1 pb-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-foreground">{title}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {event.actor}
            </span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {formatTime(event.createdAt)}
            </span>
          </div>

          {detail && !compact && (
            <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          )}

          <div className="mt-1 flex items-center gap-2">
            <span className={cn('inline-flex h-1.5 w-1.5 rounded-full', toneDotClass(tone))} />
            <span className={cn('text-[11px] capitalize', toneTextClass(tone))}>
              {event.status}
            </span>
            <span className="text-[11px] text-muted-foreground/70">· {event.phase.replace(/_/g, ' ')}</span>

            {hasDetail && !compact && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="ml-auto inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground transition hover:text-foreground"
              >
                {expanded ? (
                  <>
                    <ChevronDown className="h-3 w-3" /> hide
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3" /> detail
                  </>
                )}
              </button>
            )}
          </div>

          {expanded && hasDetail && !compact && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(event.data ?? {}, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

export function TimelineStatusIcon({ status }: { status: TimelineEvent['status'] }) {
  if (status === 'completed') return <Check className="h-3 w-3 text-success" />;
  if (status === 'failed') return <CircleX className="h-3 w-3 text-destructive" />;
  return <Info className="h-3 w-3 text-muted-foreground" />;
}
