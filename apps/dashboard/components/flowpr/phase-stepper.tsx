'use client';

import { Check, CircleDashed, CircleX, Loader2 } from 'lucide-react';
import type { RunStatus } from '@flowpr/schemas';
import { labelRunStatus, runStatuses, describeRunStatus } from '@flowpr/schemas';

import { cn } from '@/lib/utils';
import {
  formatDurationShort,
  type PhaseTimings,
} from '@/lib/phase-durations';

const phases = runStatuses.filter((status) => status !== 'failed');

interface PhaseStepperProps {
  current: RunStatus;
  variant?: 'large' | 'compact';
  className?: string;
  durations?: Map<string, PhaseTimings>;
}

export function PhaseStepper({
  current,
  variant = 'large',
  className,
  durations,
}: PhaseStepperProps) {
  const failed = current === 'failed';
  const currentIndex = failed ? phases.length - 1 : phases.indexOf(current);
  const progressPercent =
    phases.length <= 1 ? 0 : (Math.max(0, currentIndex) / (phases.length - 1)) * 100;

  if (variant === 'compact') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {labelRunStatus(current)}
          </span>
          <span>
            {failed
              ? 'Needs review'
              : `${Math.max(0, currentIndex) + 1} / ${phases.length}`}
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-500',
              failed ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Current phase
          </p>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            {labelRunStatus(current)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {failed
            ? 'Needs review'
            : `Step ${Math.max(0, currentIndex) + 1} of ${phases.length}`}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">{describeRunStatus(current)}</p>

      <div className="relative">
        <div className="absolute left-0 right-0 top-3 h-0.5 bg-border" />
        <div
          className={cn(
            'absolute left-0 top-3 h-0.5 transition-all duration-500',
            failed ? 'bg-destructive' : 'bg-primary',
          )}
          style={{ width: `${progressPercent}%` }}
        />
        <ol className="relative flex justify-between">
          {phases.map((phase, index) => {
            const done = !failed && index < currentIndex;
            const isCurrent = !failed && index === currentIndex;
            const isFuture = !failed && index > currentIndex;
            const isFailedHere = failed && index === currentIndex;
            const timing = durations?.get(phase);
            const showDuration =
              (done || isCurrent || isFailedHere) &&
              typeof timing?.durationMs === 'number' &&
              timing.durationMs > 250;

            return (
              <li
                key={phase}
                className="group flex flex-col items-center gap-2"
                title={
                  showDuration
                    ? `${labelRunStatus(phase)} · ${formatDurationShort(timing?.durationMs)}`
                    : labelRunStatus(phase)
                }
              >
                <span
                  className={cn(
                    'relative flex h-6 w-6 items-center justify-center rounded-full border transition-all',
                    done && 'border-primary bg-primary text-primary-foreground',
                    isCurrent &&
                      'border-primary bg-card text-primary animate-pulse-ring',
                    isFuture && 'border-border bg-card text-muted-foreground',
                    isFailedHere && 'border-destructive bg-destructive text-destructive-foreground',
                  )}
                >
                  {done && <Check className="h-3 w-3" />}
                  {isCurrent && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isFuture && <CircleDashed className="h-3 w-3" />}
                  {isFailedHere && <CircleX className="h-3 w-3" />}
                </span>
                <span
                  className={cn(
                    'hidden max-w-[80px] text-center text-[10px] uppercase tracking-wide transition-opacity lg:block',
                    done && 'text-foreground',
                    isCurrent && 'font-semibold text-primary',
                    isFuture && 'text-muted-foreground/70',
                    isFailedHere && 'text-destructive',
                  )}
                >
                  {labelRunStatus(phase)}
                </span>
                {showDuration && (
                  <span
                    className={cn(
                      'hidden font-mono text-[10px] tabular-nums lg:block',
                      isCurrent ? 'text-primary' : 'text-muted-foreground/70',
                    )}
                  >
                    {formatDurationShort(timing?.durationMs)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
