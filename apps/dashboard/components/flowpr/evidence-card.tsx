import { AlertCircle, Camera, ExternalLink, FileArchive, Monitor, Play } from 'lucide-react';
import type { BrowserObservation } from '@flowpr/schemas';
import { labelBrowserObservationStatus } from '@flowpr/schemas';
import { classifyFailure, describeFailureCategory } from '@flowpr/tools/failure-classifier';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { artifactSrc, playwrightTraceViewerUrl } from '@/lib/artifact-url';

interface EvidenceCardProps {
  observation?: BrowserObservation;
  label: string;
  description: string;
  runId: string;
  liveStreamingUrl?: string;
  className?: string;
}

export function EvidenceCard({
  observation,
  label,
  description,
  runId,
  liveStreamingUrl,
  className,
}: EvidenceCardProps) {
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
            <StateBadge state={liveStreamingUrl ? 'running' : 'queued'} />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {liveStreamingUrl ? (
            <div className="relative overflow-hidden rounded-md border border-primary/40 bg-muted/40">
              <iframe
                src={liveStreamingUrl}
                title={`${label} live view`}
                className="aspect-video w-full"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-scripts allow-same-origin"
              />
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                live
              </span>
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              Awaiting browser evidence…
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const viewport = observation.viewport as { width?: number; height?: number } | undefined;
  const viewportLabel = viewport?.width && viewport?.height
    ? `${viewport.width}×${viewport.height}`
    : 'default';
  const rawResult = observation.result as Record<string, unknown> | undefined;
  const storedStreamingUrl = typeof rawResult?.streamingUrl === 'string' ? rawResult.streamingUrl : undefined;
  const streamingUrl = liveStreamingUrl ?? storedStreamingUrl;
  const isActive = observation.status === 'queued' || Boolean(liveStreamingUrl);
  const screenshotSrc = artifactSrc(runId, {
    key: observation.screenshotKey,
    url: observation.screenshotUrl,
  });
  const traceProxySrc = artifactSrc(runId, {
    key: observation.traceKey,
    url: observation.traceUrl,
  });
  const traceViewerHref = traceProxySrc ? playwrightTraceViewerUrl(traceProxySrc) : undefined;

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
        {isActive && streamingUrl ? (
          <div className="relative overflow-hidden rounded-md border border-primary/40 bg-muted/40">
            <iframe
              src={streamingUrl}
              title={`${label} live view`}
              className="aspect-video w-full"
              allow="clipboard-read; clipboard-write"
              sandbox="allow-scripts allow-same-origin"
            />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              live
            </span>
          </div>
        ) : screenshotSrc ? (
          <a
            href={screenshotSrc}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border border-border"
          >
            <img
              src={screenshotSrc}
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

        {(observation.status === 'failed' || observation.status === 'errored') &&
          (() => {
            const classified = classifyFailure(
              observation.observedBehavior ?? (rawResult?.visibleError as string | undefined) ?? '',
            );
            return (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {classified.summary}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {classified.category.replace(/_/g, ' ')}
                    </span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {describeFailureCategory(classified.category)}
                  </p>
                </div>
              </div>
            );
          })()}

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

        {(traceProxySrc || screenshotSrc || streamingUrl) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {screenshotSrc && (
              <a
                href={screenshotSrc}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <Camera className="h-3 w-3" /> screenshot
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {traceViewerHref ? (
              <a
                href={traceViewerHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <FileArchive className="h-3 w-3" /> trace viewer
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : traceProxySrc ? (
              <a
                href={traceProxySrc}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <FileArchive className="h-3 w-3" /> trace
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : null}
            {streamingUrl && !isActive && (
              <a
                href={streamingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <Play className="h-3 w-3" /> replay
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
