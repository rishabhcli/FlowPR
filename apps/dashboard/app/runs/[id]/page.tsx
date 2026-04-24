'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  GitBranch,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { RunDetail } from '@flowpr/schemas';
import {
  labelRiskLevel,
  labelRunStatus,
  labelVerificationStatus,
} from '@flowpr/schemas';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

import { SiteHeader } from '@/components/flowpr/site-header';
import { PhaseStepper } from '@/components/flowpr/phase-stepper';
import { BeforeAfter } from '@/components/flowpr/before-after';
import { DiagnosisCard } from '@/components/flowpr/diagnosis-card';
import { PatchCard } from '@/components/flowpr/patch-card';
import { PrCard } from '@/components/flowpr/pr-card';
import { Timeline } from '@/components/flowpr/timeline';
import {
  ReadinessMeter,
  type ReadinessSummary,
} from '@/components/flowpr/readiness-meter';
import { StateBadge } from '@/components/flowpr/state-badge';
import { formatDateTime, formatTime } from '@/lib/format';

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
    }, 5000);
    return () => window.clearInterval(interval);
  }, [id]);

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
        <main className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
          </div>
        </main>
      </>
    );
  }

  const { run } = detail;
  const beforeObservation = detail.browserObservations.find(
    (obs) => obs.status === 'failed' || obs.status === 'errored',
  );
  const afterObservation = detail.browserObservations.find(
    (obs) => obs.status === 'passed',
  );
  const latestHypothesis = detail.bugHypotheses[detail.bugHypotheses.length - 1];
  const latestPatch = detail.patches[detail.patches.length - 1];
  const latestPR = detail.pullRequests[detail.pullRequests.length - 1];
  const liveVerification = detail.verificationResults.find(
    (result) => result.provider === 'tinyfish-live',
  );
  const localVerification = detail.verificationResults.find(
    (result) => result.provider === 'local',
  );

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

            <Card>
              <CardContent className="p-5">
                <PhaseStepper current={run.status} variant="large" />
              </CardContent>
            </Card>

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
                  <CardTitle>Before → After</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Failing browser evidence on the left, verified fix on the right.
                  </p>
                </CardHeader>
                <CardContent>
                  <BeforeAfter
                    before={
                      beforeObservation?.screenshotUrl
                        ? {
                            url: beforeObservation.screenshotUrl,
                            caption: beforeObservation.failedStep ?? 'Failing run',
                          }
                        : null
                    }
                    after={
                      afterObservation?.screenshotUrl
                        ? {
                            url: afterObservation.screenshotUrl,
                            caption: 'Verified fix',
                          }
                        : null
                    }
                  />
                </CardContent>
              </Card>

              <DiagnosisCard hypothesis={latestHypothesis} />

              <div className="grid gap-4 md:grid-cols-2">
                <PatchCard patch={latestPatch} />
                <PrCard pullRequest={latestPR} />
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
