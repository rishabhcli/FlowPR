'use client';

import { useMemo } from 'react';
import { CheckCircle2, CircleDashed, CircleDot } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';

export interface ReadinessItem {
  sponsor: string;
  artifactType: string;
  description: string;
  state: 'ready' | 'partial' | 'missing';
  found?: number;
  latest?: { providerId?: string; url?: string; createdAt: string };
}

export interface ReadinessSummary {
  overall: 'ready' | 'partial' | 'missing';
  readyCount: number;
  partialCount?: number;
  missingCount: number;
  items: ReadinessItem[];
}

interface ReadinessMeterProps {
  readiness?: ReadinessSummary | null;
  className?: string;
}

export function ReadinessMeter({ readiness, className }: ReadinessMeterProps) {
  const total = readiness ? readiness.items.length : 0;
  const ready = readiness?.readyCount ?? 0;
  const partial = readiness?.partialCount ?? 0;
  const missing = readiness?.missingCount ?? 0;

  const readyPct = total === 0 ? 0 : (ready / total) * 100;
  const partialPct = total === 0 ? 0 : (partial / total) * 100;

  const grouped = useMemo(() => {
    if (!readiness) return { ready: [], partial: [], missing: [] };
    return {
      ready: readiness.items.filter((i) => i.state === 'ready'),
      partial: readiness.items.filter((i) => i.state === 'partial'),
      missing: readiness.items.filter((i) => i.state === 'missing'),
    };
  }, [readiness]);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Provider readiness
          </CardTitle>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {ready}
            <span className="text-muted-foreground/60"> / {total || '—'}</span>
          </p>
        </div>
        {readiness && <StateBadge state={readiness.overall} />}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 bg-success transition-all duration-500"
            style={{ width: `${readyPct}%` }}
          />
          <div
            className="absolute inset-y-0 bg-warning/70 transition-all duration-500"
            style={{ left: `${readyPct}%`, width: `${partialPct}%` }}
          />
        </div>

        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <Legend tone="success" label="Ready" count={ready} />
          <Legend tone="warning" label="Partial" count={partial} />
          <Legend tone="danger" label="Missing" count={missing} />
        </div>

        <div className="space-y-2 pt-1">
          {[...grouped.missing, ...grouped.partial, ...grouped.ready].slice(0, 8).map((item) => (
            <ReadinessRow key={`${item.sponsor}-${item.artifactType}`} item={item} />
          ))}
          {!readiness && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Run a flow to collect provider artifacts.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Legend({ tone, label, count }: { tone: 'success' | 'warning' | 'danger'; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('h-1.5 w-1.5 rounded-full', {
          'bg-success': tone === 'success',
          'bg-warning': tone === 'warning',
          'bg-destructive': tone === 'danger',
        })}
      />
      {label} <span className="tabular-nums text-foreground">{count}</span>
    </span>
  );
}

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const Icon = item.state === 'ready' ? CheckCircle2 : item.state === 'partial' ? CircleDot : CircleDashed;
  return (
    <div className="flex items-start gap-3 text-xs">
      <Icon
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          item.state === 'ready' && 'text-success',
          item.state === 'partial' && 'text-warning',
          item.state === 'missing' && 'text-muted-foreground/60',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{item.sponsor}</span>
          <span className="truncate text-muted-foreground">{item.artifactType}</span>
        </div>
        <p className="text-[11px] text-muted-foreground/80">{item.description}</p>
        {item.latest?.createdAt && (
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            {formatRelativeTime(item.latest.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}
