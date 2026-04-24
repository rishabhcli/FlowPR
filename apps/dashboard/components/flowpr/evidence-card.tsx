import { Camera, ExternalLink, FileArchive, Monitor } from 'lucide-react';
import type { BrowserObservation } from '@flowpr/schemas';
import { labelBrowserObservationStatus } from '@flowpr/schemas';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';

interface EvidenceCardProps {
  observation?: BrowserObservation;
  label: string;
  description: string;
  className?: string;
}

export function EvidenceCard({ observation, label, description, className }: EvidenceCardProps) {
  if (!observation) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {label}
              </p>
              <p className="mt-0.5 text-sm font-medium text-foreground">{description}</p>
            </div>
            <StateBadge state="queued" />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            Awaiting browser evidence…
          </div>
        </CardContent>
      </Card>
    );
  }

  const viewport = observation.viewport as { width?: number; height?: number } | undefined;
  const viewportLabel = viewport?.width && viewport?.height
    ? `${viewport.width}×${viewport.height}`
    : 'default';

  return (
    <Card className={cn('group overflow-hidden transition-colors hover:border-primary/50', className)}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {label}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">
              {description}
            </p>
          </div>
          <StateBadge
            state={observation.status}
            label={labelBrowserObservationStatus(observation.status)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        {observation.screenshotUrl ? (
          <a
            href={observation.screenshotUrl}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border border-border"
          >
            <img
              src={observation.screenshotUrl}
              alt={`${label} screenshot`}
              className="aspect-video w-full bg-muted/40 object-cover object-top transition group-hover:scale-[1.01]"
              loading="lazy"
            />
          </a>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Camera className="mr-1.5 h-3.5 w-3.5" /> screenshot pending
          </div>
        )}

        {observation.failedStep && (
          <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="font-medium">Failed at:</span> {observation.failedStep}
          </div>
        )}

        {observation.observedBehavior && (
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {observation.observedBehavior}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Monitor className="h-3 w-3" /> {viewportLabel}
          </span>
          {observation.consoleErrors.length > 0 && (
            <span className="text-destructive">
              {observation.consoleErrors.length} console error{observation.consoleErrors.length === 1 ? '' : 's'}
            </span>
          )}
          {observation.networkErrors.length > 0 && (
            <span className="text-destructive">
              {observation.networkErrors.length} network error{observation.networkErrors.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="ml-auto font-mono">{formatTime(observation.createdAt)}</span>
        </div>

        {(observation.traceUrl || observation.screenshotUrl) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {observation.screenshotUrl && (
              <a
                href={observation.screenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <Camera className="h-3 w-3" /> screenshot
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {observation.traceUrl && (
              <a
                href={observation.traceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <FileArchive className="h-3 w-3" /> trace
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
