'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Clock,
  GitBranch,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { RunDetail } from '@flowpr/schemas';
import {
  hasPassedLocalPlaywrightObservation,
  isIgnoredRemoteLocalhostObservation,
  labelRiskLevel,
  labelRunStatus,
  labelVerificationStatus,
  validateRunEvidenceIntegrity,
} from '@flowpr/schemas';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

import { SiteHeader } from '@/components/flowpr/site-header';
import { PhaseStepper } from '@/components/flowpr/phase-stepper';
import { BeforeAfter } from '@/components/flowpr/before-after';
import { LiveProgress } from '@/components/flowpr/live-progress';
import { ResourceTiles } from '@/components/flowpr/resource-tiles';
import { artifactSrc } from '@/lib/artifact-url';
import { useRunStream } from '@/lib/use-run-stream';
import { DiagnosisCard } from '@/components/flowpr/diagnosis-card';
import { OutcomeHero } from '@/components/flowpr/outcome-hero';
import { PatchCard } from '@/components/flowpr/patch-card';
import { PrCard } from '@/components/flowpr/pr-card';
import { HandoffReportCard } from '@/components/flowpr/handoff-report-card';
import { Timeline } from '@/components/flowpr/timeline';
import {
  ReadinessMeter,
  type ReadinessSummary,
} from '@/components/flowpr/readiness-meter';
import { StateBadge } from '@/components/flowpr/state-badge';
import { formatDateTime, formatTime } from '@/lib/format';
import {
  computePhaseDurations,
  formatDurationShort,
} from '@/lib/phase-durations';

interface ReadinessResponse extends ReadinessSummary {
  runId: string;
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string>();
  const [rerunning, setRerunning] = useState(false);
  const [rerunMessage, setRerunMessage] = useState<string>();

  async function rerunVerification() {
    setRerunning(true);
    setRerunMessage(undefined);

    try {
      const response = await fetch(`/api/runs/${id}/rerun-verification`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? `Rerun request failed (${response.status})`);

      setRerunMessage(
        `Rerun queued at ${new Date(body.queuedAt).toLocaleTimeString()} — a new verification result will appear here shortly.`,
      );
    } catch (rerunError) {
      setRerunMessage(
        rerunError instanceof Error ? rerunError.message : String(rerunError),
      );
    } finally {
      setRerunning(false);
    }
  }

  async function load() {
    setError(undefined);
    const [detailResponse, readinessResponse] = await Promise.all([
      fetch(`/api/runs/${id}`, { cache: 'no-store' }),
      fetch(`/api/runs/${id}/readiness`, { cache: 'no-store' }),
    ]);
    const detailBody = await detailResponse.json();

    if (!detailResponse.ok) {
      setError(detailBody.error ?? 'Failed to load run detail');
      return;
    }

    setDetail(detailBody);
    if (readinessResponse.ok) {
      const readinessBody = await readinessResponse.json();
      setReadiness(readinessBody);
    }
  }

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [id]);

  const runStream = useRunStream(id);

  useEffect(() => {
    if (runStream.progress.length === 0) return;
    load().catch(() => undefined);
  }, [runStream.progress.length]);

  const durations = useMemo(
    () => computePhaseDurations(detail?.timelineEvents ?? []),
    [detail?.timelineEvents],
  );

  if (error) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-10">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load run</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button asChild variant="ghost" size="sm" className="mt-4">
            <Link href="/">
              <ArrowLeft className="h-3 w-3" /> Back to command center
            </Link>
          </Button>
        </main>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <SiteHeader />
        <main className="relative">
          <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot opacity-60" />
          <div className="mx-auto max-w-7xl px-6 py-8">
            <div className="mb-4 h-7 w-36 rounded skeleton-shimmer" />
            <div className="mb-3 h-3 w-24 rounded skeleton-shimmer" />
            <div className="mb-3 h-9 w-3/4 rounded skeleton-shimmer" />
            <div className="mb-6 h-3 w-1/2 rounded skeleton-shimmer" />

            <Card className="mb-4">
              <CardContent className="p-5">
                <div className="h-16 rounded skeleton-shimmer" />
              </CardContent>
            </Card>

            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <div className="h-3 w-20 rounded skeleton-shimmer" />
                    <div className="mt-3 h-7 w-24 rounded skeleton-shimmer" />
                    <div className="mt-3 h-3 w-28 rounded skeleton-shimmer" />
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <div className="h-4 w-32 rounded skeleton-shimmer" />
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="aspect-video w-full rounded-md skeleton-shimmer" />
                    <div className="aspect-video w-full rounded-md skeleton-shimmer" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="h-4 w-24 rounded skeleton-shimmer" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-3 w-full rounded skeleton-shimmer" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <p className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading run timeline…
            </p>
          </div>
        </main>
      </>
    );
  }

  const { run } = detail;
  const evidenceIntegrityIssues = validateRunEvidenceIntegrity(detail);
  const dangerEvidenceIntegrityIssues = evidenceIntegrityIssues.filter(
    (issue) => issue.severity === 'danger',
  );
  const latestHypothesis = detail.bugHypotheses[detail.bugHypotheses.length - 1];
  const latestPatch = detail.patches[detail.patches.length - 1];
  const latestPR = detail.pullRequests[detail.pullRequests.length - 1];
  const hasHandoffReport = detail.providerArtifacts.some(
    (artifact) => artifact.artifactType === 'investigation_report',
  );
  const liveVerification = detail.verificationResults.find(
    (result) => result.provider === 'tinyfish-live',
  );
  const localVerification = detail.verificationResults.find(
    (result) => result.provider === 'local',
  );
  const localPlaywrightPassed = hasPassedLocalPlaywrightObservation(detail.browserObservations);
  const isIgnoredObservation = (obs: (typeof detail.browserObservations)[number]) =>
    isIgnoredRemoteLocalhostObservation(run.previewUrl, detail.browserObservations, obs);
  const ignoredRemoteObservations = detail.browserObservations.filter(isIgnoredObservation);
  const environmentOnlyRun =
    localPlaywrightPassed &&
    ignoredRemoteObservations.length > 0 &&
    !latestHypothesis &&
    !latestPatch;
  const hasScreenshot = (obs: (typeof detail.browserObservations)[number]) =>
    Boolean(obs.screenshotKey || obs.screenshotUrl);
  const observationsWithScreenshots = [...detail.browserObservations]
    .filter(hasScreenshot)
    .sort(
      (a, b) =>
        new Date(a.createdAt ?? 0).getTime() -
        new Date(b.createdAt ?? 0).getTime(),
    );
  const actionableObservationsWithScreenshots = observationsWithScreenshots.filter(
    (obs) => !isIgnoredObservation(obs),
  );
  const ignoredObservationsWithScreenshots = observationsWithScreenshots.filter(isIgnoredObservation);
  // Before = first actionable failing observation that has a screenshot. For
  // local-only runs, show the remote reachability screenshot as environment proof.
  const beforeObservation =
    actionableObservationsWithScreenshots.find(
      (obs) => obs.status === 'failed' || obs.status === 'errored',
    ) ??
    (environmentOnlyRun
      ? ignoredObservationsWithScreenshots[0]
      : observationsWithScreenshots.find((obs) => obs.status === 'failed' || obs.status === 'errored') ??
        observationsWithScreenshots[0]);
  // After = passing observation if one exists; otherwise the most recent
  // observation (post-patch state). Avoid duplicating the Before frame.
  const passedObservation = observationsWithScreenshots.find(
    (obs) => obs.status === 'passed',
  );
  const afterObservation =
    passedObservation;
  const afterIsPassed = Boolean(passedObservation);
  const localProofDetails = (() => {
    const steps = localVerification?.raw?.steps;
    if (!Array.isArray(steps)) return undefined;
    return steps
      .map((step) => {
        if (!step || typeof step !== 'object') return undefined;
        const record = step as Record<string, unknown>;
        const name = typeof record.step === 'string' ? record.step : undefined;
        const status = typeof record.status === 'string' ? record.status : undefined;
        return name && status ? `${name}: ${status}` : undefined;
      })
      .filter((value): value is string => Boolean(value));
  })();
  const localVerificationIsProof =
    !afterObservation &&
    localVerification?.status === 'passed' &&
    latestPatch?.status === 'generated';
  const runFinished = run.status === 'done' || run.status === 'failed';

  const elapsedMs = run.startedAt
    ? (run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
      new Date(run.startedAt).getTime()
    : 0;

  return (
    <>
      <SiteHeader />
      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot opacity-60" />

        <div className="mx-auto max-w-7xl px-6 py-8">
          <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
            <Link href="/">
              <ArrowLeft className="h-3 w-3" /> Command center
            </Link>
          </Button>

          <section className="mb-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  Run {run.id.slice(0, 8)}
                </p>
                <h1 className="mt-2 font-display text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                  {run.flowGoal}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <GitBranch className="h-3 w-3" />
                    {run.owner}/{run.repo}@{run.baseBranch}
                  </span>
                  <span>·</span>
                  <span>Started {formatDateTime(run.startedAt ?? run.createdAt)}</span>
                  {run.completedAt && (
                    <>
                      <span>·</span>
                      <span>Completed {formatDateTime(run.completedAt)}</span>
                    </>
                  )}
                  {elapsedMs > 0 && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="h-3 w-3" /> {formatDurationShort(elapsedMs)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <StateBadge state={run.status} label={labelRunStatus(run.status)} />
                  <StateBadge state={run.riskLevel} label={labelRiskLevel(run.riskLevel)} />
                </div>
                <div className="flex gap-2">
                  {latestPR?.url && (
                    <Button asChild>
                      <a href={latestPR.url} target="_blank" rel="noreferrer">
                        View PR <ArrowUpRight className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="default"
                    onClick={rerunVerification}
                    disabled={rerunning}
                  >
                    {rerunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Re-run verification
                  </Button>
                </div>
              </div>
            </div>

            <OutcomeHero detail={detail} />

            {evidenceIntegrityIssues.length > 0 && (
              <Alert
                variant={dangerEvidenceIntegrityIssues.length > 0 ? 'destructive' : 'warning'}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  Provider proof needs review
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {dangerEvidenceIntegrityIssues.length > 0
                      ? `${dangerEvidenceIntegrityIssues.length} evidence claim${dangerEvidenceIntegrityIssues.length === 1 ? '' : 's'} lack durable provider artifacts.`
                      : 'All critical proof exists, but one or more governance/support records should be checked.'}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {evidenceIntegrityIssues.slice(0, 4).map((issue) => (
                      <li key={issue.id}>
                        {issue.message} Expected: <span className="font-mono">{issue.expectedArtifact}</span>.
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardContent className="p-5">
                <PhaseStepper
                  current={run.status}
                  variant="large"
                  durations={durations}
                />
              </CardContent>
            </Card>

            <ResourceTiles detail={detail} />

            {rerunMessage && (
              <Alert variant="default">
                <AlertDescription>{rerunMessage}</AlertDescription>
              </Alert>
            )}
            {run.failureSummary && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Needs review</AlertTitle>
                <AlertDescription>{run.failureSummary}</AlertDescription>
              </Alert>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    {environmentOnlyRun || localVerificationIsProof ? 'Browser failure → Local proof' : 'Before → After'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {environmentOnlyRun
                      ? 'TinyFish could not reach the loopback preview, while local Playwright proved the flow.'
                      : localVerificationIsProof
                        ? 'Failing browser evidence on the left, local verification proof on the right.'
                      : 'Failing browser evidence on the left, verified fix on the right.'}
                  </p>
                </CardHeader>
                <CardContent>
                  <BeforeAfter
                    runFinished={runFinished}
                    afterIsPassed={afterIsPassed || localVerificationIsProof}
                    beforeLabel={environmentOnlyRun ? 'Remote' : undefined}
                    afterLabel={environmentOnlyRun || localVerificationIsProof ? 'Local · passed' : undefined}
                    beforeBadge={environmentOnlyRun ? 'provider unreachable' : undefined}
                    afterBadge={environmentOnlyRun || localVerificationIsProof ? 'local passed' : undefined}
                    before={(() => {
                      const src = beforeObservation
                        ? artifactSrc(run.id, {
                            key: beforeObservation.screenshotKey,
                            url: beforeObservation.screenshotUrl,
                          })
                        : undefined;
                      return src
                        ? {
                            url: src,
                            caption: environmentOnlyRun
                              ? 'Remote browser could not reach localhost'
                              : beforeObservation?.failedStep ?? 'Failing run',
                          }
                        : null;
                    })()}
                    after={(() => {
                      const src = afterObservation
                        ? artifactSrc(run.id, {
                            key: afterObservation.screenshotKey,
                            url: afterObservation.screenshotUrl,
                          })
                        : undefined;
                      if (!src) return null;
                      return {
                        url: src,
                        caption: environmentOnlyRun
                          ? 'Local Playwright reached success'
                          : afterIsPassed
                            ? 'Verified fix'
                            : 'Post-patch state',
                      };
                    })()}
                    afterProof={
                      localVerificationIsProof && localVerification
                        ? {
                            summary: localVerification.summary,
                            details: localProofDetails,
                          }
                        : null
                    }
                  />
                </CardContent>
              </Card>

              <DiagnosisCard hypothesis={latestHypothesis} />

              <div className="grid gap-4 md:grid-cols-2">
                <PatchCard patch={latestPatch} />
                <PrCard
                  pullRequest={latestPR}
                  runId={run.id}
                  onMerged={() => {
                    load().catch(() => undefined);
                  }}
                />
                {hasHandoffReport && (
                  <div className="md:col-span-2">
                    <HandoffReportCard detail={detail} />
                  </div>
                )}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Verification</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Two re-verifications: local Playwright and live TinyFish.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {[localVerification, liveVerification].map((verification, i) => {
                    const label = i === 0 ? 'Local Playwright' : 'TinyFish live';
                    if (!verification) {
                      return (
                        <div
                          key={label}
                          className="rounded-md border border-dashed border-border bg-card/30 p-4 text-xs text-muted-foreground"
                        >
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">
                            {label}
                          </p>
                          <p>Awaiting verification…</p>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={verification.id}
                        className="rounded-md border border-border bg-card/40 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                            {label}
                          </p>
                          <StateBadge
                            state={verification.status}
                            label={labelVerificationStatus(verification.status)}
                          />
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {verification.summary}
                        </p>
                        {verification.testCommand && (
                          <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                            $ {verification.testCommand}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground/70">
                          {formatTime(verification.createdAt)}
                        </p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
              <LiveProgress progress={runStream.progress} connected={runStream.connected} />
              <ReadinessMeter readiness={readiness} />

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                    Timeline
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {detail.timelineEvents.length} events
                  </span>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[520px] px-5 pb-5">
                    <Timeline events={detail.timelineEvents} />
                  </ScrollArea>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
