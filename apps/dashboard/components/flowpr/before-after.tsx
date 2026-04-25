'use client';

import { useState } from 'react';
import { ArrowRight, CircleCheck, CircleDashed, CircleX, Camera } from 'lucide-react';

import { cn } from '@/lib/utils';

interface BeforeAfterProps {
  before?: { url: string; caption?: string } | null;
  after?: { url: string; caption?: string } | null;
  runFinished?: boolean;
  afterIsPassed?: boolean;
  className?: string;
}

// URLs passed in are already proxy URLs built by the caller via artifactSrc().

export function BeforeAfter({
  before,
  after,
  runFinished = false,
  afterIsPassed = false,
  className,
}: BeforeAfterProps) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2', className)}>
      <Panel
        kind="before"
        label="Before"
        caption={before?.caption ?? 'Seeded bug reproduction'}
        url={before?.url}
        emptyState={runFinished ? 'no_failure_capture' : 'awaiting_failure'}
      />
      <Panel
        kind="after"
        label={afterIsPassed ? 'After · verified' : 'After'}
        caption={after?.caption ?? (afterIsPassed ? 'Verified fix' : 'Post-patch state')}
        url={after?.url}
        emptyState={
          runFinished ? 'no_verified_capture' : 'awaiting_verification'
        }
      />
    </div>
  );
}

type EmptyState =
  | 'awaiting_failure'
  | 'awaiting_verification'
  | 'no_failure_capture'
  | 'no_verified_capture';

const EMPTY_COPY: Record<EmptyState, string> = {
  awaiting_failure: 'Failing screenshot pending…',
  awaiting_verification: 'Awaiting verification screenshot…',
  no_failure_capture: 'No failure screenshot captured.',
  no_verified_capture: 'Verification did not capture a passing screenshot.',
};

function Panel({
  kind,
  label,
  caption,
  url,
  emptyState,
}: {
  kind: 'before' | 'after';
  label: string;
  caption: string;
  url?: string;
  emptyState: EmptyState;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const accent =
    kind === 'before'
      ? 'border-destructive/40 bg-destructive/5'
      : 'border-success/40 bg-success/5';
  const finalState = errored
    ? kind === 'before'
      ? ('no_failure_capture' as EmptyState)
      : ('no_verified_capture' as EmptyState)
    : emptyState;
  const showImage = Boolean(url) && !errored;

  return (
    <figure
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border transition',
        showImage ? accent : 'border-dashed border-border bg-card/40',
      )}
    >
      <figcaption className="flex items-center justify-between px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          {kind === 'before' ? (
            <CircleX className="h-3.5 w-3.5 text-destructive" />
          ) : showImage ? (
            <CircleCheck className="h-3.5 w-3.5 text-success" />
          ) : (
            <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span
            className={cn(
              'text-[11px] font-semibold uppercase tracking-widest',
              kind === 'before'
                ? 'text-destructive'
                : showImage
                  ? 'text-success'
                  : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        </div>
        <span className="truncate text-muted-foreground">{caption}</span>
      </figcaption>

      {showImage && url ? (
        <div className="relative aspect-[9/16] max-h-[460px] w-full overflow-hidden bg-muted/30 md:aspect-[390/600]">
          <img
            src={url}
            alt={caption}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cn(
              // object-bottom + object-cover keeps mobile-checkout bug zones
              // (fixed banners, sticky CTAs at the viewport bottom) in frame
              // even when the underlying capture is a tall full-page screenshot.
              'absolute inset-0 h-full w-full object-cover object-bottom transition-all duration-500',
              loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
            )}
            loading="lazy"
          />
          {!loaded && (
            <div className="skeleton-shimmer absolute inset-0" />
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0"
            aria-label={`Open ${label} screenshot in a new tab`}
          />
          <span
            className={cn(
              'pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur',
              kind === 'before'
                ? 'bg-destructive/20 text-destructive'
                : 'bg-success/20 text-success',
            )}
          >
            {kind === 'before' ? 'bug captured' : 'after patch'}
          </span>
        </div>
      ) : (
        <div className="flex aspect-[9/16] max-h-[460px] flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground md:aspect-[390/600]">
          <Camera className="h-4 w-4" />
          <span>{EMPTY_COPY[finalState]}</span>
          <ArrowRight className="mt-2 h-3 w-3 rotate-180 opacity-0" />
        </div>
      )}
    </figure>
  );
}
