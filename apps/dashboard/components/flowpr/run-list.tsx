'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { FlowPrRun } from '@flowpr/schemas';
import { labelRunStatus } from '@flowpr/schemas';

import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';
import { formatRelativeTime, truncate } from '@/lib/format';

interface RunListProps {
  runs: FlowPrRun[];
  selectedRunId?: string;
  onSelect?: (runId: string) => void;
  className?: string;
  maxItems?: number;
}

export function RunList({
  runs,
  selectedRunId,
  onSelect,
  className,
  maxItems = 8,
}: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground', className)}>
        No runs yet. Describe the first journey above.
      </div>
    );
  }

  return (
      <ul className={cn('divide-y divide-border/60 overflow-hidden rounded-md border border-border', className)}>
      {runs.slice(0, maxItems).map((run) => {
        const isSelected = run.id === selectedRunId;
        const href = `/runs/${run.id}`;
        const content = (
          <div
            className={cn(
              'group flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
              isSelected
                ? 'bg-accent/60'
                : 'hover:bg-accent/30',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {truncate(run.flowGoal, 60)}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">
                  {run.owner}/{run.repo}
                </span>
                <span>·</span>
                <span>{formatRelativeTime(run.startedAt ?? run.createdAt)}</span>
              </div>
            </div>
            <StateBadge state={run.status} label={labelRunStatus(run.status)} />
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        );

        return (
          <li key={run.id}>
            <Link
              href={href}
              onClick={() => onSelect?.(run.id)}
              className="block w-full"
            >
              {content}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
