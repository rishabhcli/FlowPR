'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowUpRight,
  CircleCheck,
  Clock,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Radio,
} from 'lucide-react';
import type { RunDetail } from '@flowpr/schemas';
import { labelRiskLevel, labelRunStatus } from '@flowpr/schemas';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateTime, formatTime } from '@/lib/format';
import { artifactSrc } from '@/lib/artifact-url';
import {
  computePhaseDurations,
  formatDurationShort,
} from '@/lib/phase-durations';

import { PhaseStepper } from '@/components/flowpr/phase-stepper';
import { StateBadge } from '@/components/flowpr/state-badge';
import type { RunProgressEntry, LiveStreamEntry } from '@/lib/use-run-stream';

interface RunPulseProps {
  detail: RunDetail | null;
  progress?: RunProgressEntry[];
  liveStreams?: LiveStreamEntry[];
  connected?: boolean;
  className?: string;
  showDetailLink?: boolean;
}

export function RunPulse({
  detail,
  progress = [],
  liveStreams = [],
  connected = false,
  className,
  showDetailLink = true,
}: RunPulseProps) {
  const durations = useMemo(
    () => computePhaseDurations(detail?.timelineEvents ?? []),
    [detail?.timelineEvents],
  );

  if (!detail) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <Radio className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-base font-medium text-foreground">
              Start a run to see it here.
            </p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              FlowPR drives a real browser, explains failures, opens a PR, and
              reports back here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { run } = detail;
  const latestPatch = detail.patches[detail.patches.length - 1];
  const latestPR = detail.pullRequests[detail.pullRequests.length - 1];
  const liveVerification = detail.verificationResults.find(
    (result) => result.provider === 'tinyfish-live',
  );
  const localVerification = detail.verificationResults.find(
    (result) => result.provider === 'local',
  );

  const tinyfishLive = liveStreams.find((entry) => entry.provider === 'tinyfish');
  const liveActive = Boolean(tinyfishLive);

  const failingObservation =
    detail.browserObservations.find(
      (obs) =>
        (obs.status === 'failed' || obs.status === 'errored') &&
        (obs.screenshotKey || obs.screenshotUrl),
    ) ?? detail.browserObservations.find((obs) => obs.status === 'failed');
  const passingObservation =
    detail.browserObservations.find(
      (obs) => obs.status === 'passed' && (obs.screenshotKey || obs.screenshotUrl),
    ) ?? detail.browserObservations.find((obs) => obs.status === 'passed');

  const beforeUrl = failingObservation
    ? artifactSrc(run.id, {
        key: failingObservation.screenshotKey,
        url: failingObservation.screenshotUrl,
      })
    : undefined;
  const afterUrl = passingObservation
    ? artifactSrc(run.id, {
        key: passingObservation.screenshotKey,
        url: passingObservation.screenshotUrl,
      })
    : undefined;

  const elapsedMs = run.startedAt
    ? (run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
      new Date(run.startedAt).getTime()
    : 0;

  const lastProgress = progress[progress.length - 1];

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="space-y-4 border-b border-border/60 bg-card/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Live run · {run.id.slice(0, 8)}
            </p>
            <h2 className="mt-1 text-balance text-lg font-semibold leading-snug text-foreground">
              {run.flowGoal}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-mono">
                <GitBranch className="h-3 w-3" />
                {run.owner}/{run.repo}@{run.baseBranch}
              </span>
              <span>·</span>
              <span>{formatDateTime(run.startedAt ?? run.createdAt)}</span>
              {elapsedMs > 0 && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Clock className="h-3 w-3" />
                    {formatDurationShort(elapsedMs)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-1.5">
              <StateBadge state={run.status} label={labelRunStatus(run.status)} />
              <StateBadge state={run.riskLevel} label={labelRiskLevel(run.riskLevel)} />
            </div>
            <div className="flex items-center gap-1">
              {latestPR?.url && (
                <Button asChild size="sm" variant="default" className="text-xs">
                  <a href={latestPR.url} target="_blank" rel="noreferrer">
                    <GitPullRequest className="h-3 w-3" /> PR
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </Button>
              )}
              {showDetailLink && (
                <Button asChild variant="ghost" size="sm" className="text-xs">
                  <Link href={`/runs/${run.id}`}>
                    Detail <ExternalLink className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        <PhaseStepper
          current={run.status}
          variant="large"
          durations={durations}
        />
      </CardHeader>

      <CardContent className="grid gap-4 p-5 md:grid-cols-2">
        <PulseScreenshot
          label="Before"
          tone="danger"
          src={beforeUrl}
          caption={failingObservation?.failedStep ?? 'Failure reproduction'}
          fallback="Awaiting failing screenshot…"
        />
        <PulseScreenshot
          label="After"
          tone="success"
          src={afterUrl}
          caption="Verified fix"
          fallback="Awaiting verified screenshot…"
          liveStreamUrl={
            !afterUrl && liveActive ? tinyfishLive?.streamingUrl : undefined
          }
        />

        <PulseSummaryRow
          label="Patch"
          empty="not generated yet"
          summary={latestPatch?.summary}
          right={
            latestPatch && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                {latestPatch.filesChanged.length} file
                {latestPatch.filesChanged.length === 1 ? '' : 's'}
              </span>
            )
          }
        />
        <PulseSummaryRow
          label="Pull request"
          empty="awaiting verification"
          summary={latestPR?.title}
          right={
            latestPR?.number != null ? (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                #{latestPR.number}
              </span>
            ) : null
          }
        />
        <PulseSummaryRow
          label="Local verify"
          empty="—"
          summary={localVerification?.summary}
          right={
            localVerification && (
              <StateBadge
                state={localVerification.status}
                label={localVerification.status}
                dot={false}
              />
            )
          }
        />
        <PulseSummaryRow
          label="Live verify"
          empty="—"
          summary={liveVerification?.summary}
          right={
            liveVerification && (
              <StateBadge
                state={liveVerification.status}
                label={liveVerification.status}
                dot={false}
              />
            )
          }
        />
      </CardContent>

      <div className="border-t border-border/60 bg-card/30 px-5 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
              connected
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-muted/40 bg-muted/20 text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'animate-pulse bg-success' : 'bg-muted-foreground/50',
              )}
            />
            {connected ? 'streaming' : 'idle'}
          </span>
          {lastProgress ? (
            <p className="min-w-0 flex-1 truncate">
              <span className="font-mono uppercase tracking-wide text-muted-foreground/80">
                {lastProgress.actor ?? 'system'}
              </span>{' '}
              <span className="text-foreground">{lastProgress.message}</span>
              {lastProgress.createdAt && (
                <span className="ml-2 font-mono text-muted-foreground/70">
                  {formatTime(lastProgress.createdAt)}
                </span>
              )}
            </p>
          ) : (
            <span className="text-muted-foreground/80">
              Awaiting next event…
            </span>
          )}
          {run.completedAt && (
            <span className="ml-auto inline-flex items-center gap-1 text-success">
              <CircleCheck className="h-3 w-3" /> completed
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function PulseScreenshot({
  label,
  tone,
  src,
  caption,
  fallback,
  liveStreamUrl,
}: {
  label: string;
  tone: 'danger' | 'success';
  src?: string;
  caption: string;
  fallback: string;
  liveStreamUrl?: string;
}) {
  const accent =
    tone === 'danger'
      ? 'border-destructive/40 bg-destructive/5'
      : 'border-success/40 bg-success/5';
  const labelTone =
    tone === 'danger' ? 'text-destructive' : 'text-success';

  return (
    <figure
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-md border',
        src || liveStreamUrl ? accent : 'border-dashed border-border bg-card/40',
      )}
    >
      <figcaption className="flex items-center justify-between px-3 py-2 text-[11px]">
        <span
          className={cn(
            'font-semibold uppercase tracking-widest',
            src || liveStreamUrl ? labelTone : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        <span className="truncate text-muted-foreground">{caption}</span>
      </figcaption>
      {liveStreamUrl ? (
        <div className="relative aspect-video w-full overflow-hidden bg-black/40">
          <iframe
            src={liveStreamUrl}
            title={`${label} live view`}
            className="h-full w-full"
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin"
          />
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            live
          </span>
        </div>
      ) : src ? (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="relative block aspect-video w-full overflow-hidden bg-muted/30"
        >
          <img
            src={src}
            alt={`${label} screenshot`}
            className="absolute inset-0 h-full w-full object-cover object-top transition group-hover:scale-[1.01]"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-muted/20 text-[11px] text-muted-foreground">
          {fallback}
        </div>
      )}
    </figure>
  );
}

function PulseSummaryRow({
  label,
  summary,
  empty,
  right,
}: {
  label: string;
  summary?: string;
  empty: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          {label}
        </p>
        <p
          className={cn(
            'mt-0.5 line-clamp-2 text-xs',
            summary ? 'text-foreground' : 'text-muted-foreground italic',
          )}
        >
          {summary ?? empty}
        </p>
      </div>
      {right && <div className="shrink-0 self-center">{right}</div>}
    </div>
  );
}
