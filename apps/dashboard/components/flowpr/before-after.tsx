'use client';

import { useState } from 'react';
import { ArrowRight, CircleCheck, CircleX, Camera } from 'lucide-react';

import { cn } from '@/lib/utils';

interface BeforeAfterProps {
  before?: { url: string; caption?: string } | null;
  after?: { url: string; caption?: string } | null;
  className?: string;
}

// URLs passed in are already proxy URLs built by the caller via artifactSrc().

export function BeforeAfter({ before, after, className }: BeforeAfterProps) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2', className)}>
      <Panel
        kind="before"
        label="Before"
        caption={before?.caption ?? 'Seeded bug reproduction'}
        url={before?.url}
      />
      <Panel
        kind="after"
        label="After"
        caption={after?.caption ?? 'Verified fix'}
        url={after?.url}
      />
    </div>
  );
}

function Panel({
  kind,
  label,
  caption,
  url,
}: {
  kind: 'before' | 'after';
  label: string;
  caption: string;
  url?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const accent =
    kind === 'before'
      ? 'border-destructive/40 bg-destructive/5'
      : 'border-success/40 bg-success/5';

  return (
    <figure
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border transition',
        url ? accent : 'border-dashed border-border bg-card/40',
      )}
    >
      <figcaption className="flex items-center justify-between px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          {kind === 'before' ? (
            <CircleX className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CircleCheck className="h-3.5 w-3.5 text-success" />
          )}
          <span
            className={cn(
              'text-[11px] font-semibold uppercase tracking-widest',
              kind === 'before' ? 'text-destructive' : 'text-success',
            )}
          >
            {label}
          </span>
        </div>
        <span className="text-muted-foreground">{caption}</span>
      </figcaption>

      {url ? (
        <div className="relative aspect-[9/16] max-h-[420px] w-full overflow-hidden bg-muted/30 md:aspect-[390/600]">
          <img
            src={url}
            alt={caption}
            onLoad={() => setLoaded(true)}
            className={cn(
              'absolute inset-0 h-full w-full object-cover object-top transition-all duration-500',
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
        </div>
      ) : (
        <div className="flex aspect-[9/16] max-h-[420px] flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground md:aspect-[390/600]">
          <Camera className="h-4 w-4" />
          <span>{kind === 'before' ? 'Failing screenshot pending…' : 'Awaiting verification…'}</span>
          <ArrowRight className="mt-2 h-3 w-3 rotate-180 opacity-0" />
        </div>
      )}
    </figure>
  );
}
