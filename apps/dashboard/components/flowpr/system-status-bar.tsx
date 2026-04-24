'use client';

import Link from 'next/link';
import { AlertTriangle, Cpu, Inbox, Radio, Siren } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useObservabilitySummary } from '@/lib/use-observability';

interface SystemStatusBarProps {
  className?: string;
  variant?: 'header' | 'panel';
}

function pillTone(state: 'ok' | 'warn' | 'danger' | 'idle'): string {
  if (state === 'ok') return 'border-success/40 bg-success/10 text-success';
  if (state === 'warn') return 'border-warning/40 bg-warning/10 text-warning';
  if (state === 'danger')
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-border bg-card/60 text-muted-foreground';
}

function workerState(alive: number): 'ok' | 'warn' | 'danger' {
  if (alive === 0) return 'danger';
  return 'ok';
}

function deadLetterState(count: number): 'ok' | 'warn' | 'danger' {
  if (count === 0) return 'ok';
  if (count < 3) return 'warn';
  return 'danger';
}

function queueState(active: number, alive: number): 'idle' | 'ok' | 'warn' {
  if (active === 0) return 'idle';
  if (alive === 0) return 'warn';
  return 'ok';
}

export function SystemStatusBar({
  className,
  variant = 'header',
}: SystemStatusBarProps) {
  const { data, loading, error } = useObservabilitySummary({ intervalMs: 8000 });

  if (loading && !data) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-[11px] text-muted-foreground',
          variant === 'panel' && 'w-full justify-start',
          className,
        )}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
        loading status…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Link
        href="/health"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[11px] font-medium text-warning transition hover:bg-warning/20',
          variant === 'panel' && 'w-full justify-start',
          className,
        )}
        title={error}
      >
        <AlertTriangle className="h-3 w-3" />
        status unavailable
      </Link>
    );
  }

  const workerTone = workerState(data.workers.alive);
  const queueTone = queueState(data.runs.active, data.workers.alive);
  const dlTone = deadLetterState(data.deadLetter.count);

  const items = [
    {
      key: 'workers',
      label: `${data.workers.alive} worker${data.workers.alive === 1 ? '' : 's'}`,
      tone: workerTone,
      icon: Cpu,
      href: '/health',
      title:
        data.workers.alive > 0
          ? `${data.workers.alive} of ${data.workers.total} alive`
          : 'No workers heartbeat in the last 30s',
    },
    {
      key: 'queue',
      label:
        data.runs.active === 0
          ? 'idle'
          : `${data.runs.active} active${data.runs.queued > 0 ? ` · ${data.runs.queued} queued` : ''}`,
      tone: queueTone,
      icon: Radio,
      href: '/',
      title:
        data.runs.active === 0
          ? 'No runs in flight'
          : `${data.runs.active} runs in flight, ${data.runs.queued} queued`,
    },
  ] as const;

  const hasDeadLetter = data.deadLetter.count > 0;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        variant === 'panel' && 'flex-wrap',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.title}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            pillTone(item.tone),
          )}
        >
          <item.icon className="h-3 w-3" />
          {item.label}
        </Link>
      ))}

      {hasDeadLetter && (
        <Link
          href={
            data.deadLetter.mostRecentRunId
              ? `/runs/${data.deadLetter.mostRecentRunId}`
              : '/health'
          }
          title="Dead-lettered events need review"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            pillTone(dlTone),
          )}
        >
          <Siren className="h-3 w-3" />
          {data.deadLetter.count} blocked
        </Link>
      )}

      {variant === 'panel' && data.runs.total24h > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
          title={`${data.runs.done24h} done · ${data.runs.failed24h} failed in last 24h`}
        >
          <Inbox className="h-3 w-3" />
          {data.runs.total24h} runs / 24h
        </span>
      )}
    </div>
  );
}
