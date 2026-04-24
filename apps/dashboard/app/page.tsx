'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Info,
  Radio,
} from 'lucide-react';
import type { FlowPrRun, RiskLevel, RunDetail } from '@flowpr/schemas';
import { labelRiskLevel, labelRunStatus } from '@flowpr/schemas';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

import { SiteHeader } from '@/components/flowpr/site-header';
import { RunForm } from '@/components/flowpr/run-form';
import { RunList } from '@/components/flowpr/run-list';
import { PhaseStepper } from '@/components/flowpr/phase-stepper';
import { Timeline } from '@/components/flowpr/timeline';
import { EvidenceCard } from '@/components/flowpr/evidence-card';
import { DiagnosisCard } from '@/components/flowpr/diagnosis-card';
import { PatchCard } from '@/components/flowpr/patch-card';
import { PrCard } from '@/components/flowpr/pr-card';
import { ReadinessMeter } from '@/components/flowpr/readiness-meter';
import {
  SponsorRail,
  type SponsorStatus,
} from '@/components/flowpr/sponsor-rail';
import { StateBadge } from '@/components/flowpr/state-badge';
import { DeadLetterStrip } from '@/components/flowpr/dead-letter-strip';
import { WorkerStatusNotice } from '@/components/flowpr/worker-status-notice';
import { formatDateTime } from '@/lib/format';
import { useRunStream } from '@/lib/use-run-stream';

interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
}

interface ReadinessResponse {
  runId: string;
  overall: 'ready' | 'partial' | 'missing';
  readyCount: number;
  partialCount: number;
  missingCount: number;
  items: Array<{
    sponsor: string;
    artifactType: string;
    description: string;
    state: 'ready' | 'partial' | 'missing';
    found: number;
    latest?: { providerId?: string; url?: string; createdAt: string };
  }>;
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<FlowPrRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [sponsorStatuses, setSponsorStatuses] = useState<SponsorStatus[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  async function loadRuns() {
    const response = await fetch('/api/runs', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load runs');
    setRuns(body.runs);
    setSelectedRunId((current) => current ?? body.runs[0]?.id);
  }

  async function loadSponsorStatuses() {
    const response = await fetch('/api/sponsors/status', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error ?? 'Failed to load sponsor status');
    setSponsorStatuses(body.statuses);
  }

  async function loadRunDetail(runId: string) {
    const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load run detail');
    setRunDetail(body);
  }

  async function loadReadiness(runId: string) {
    const response = await fetch(`/api/runs/${runId}/readiness`, {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const body = (await response.json()) as ReadinessResponse;
    setReadiness(body);
  }

  useEffect(() => {
    loadRuns().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
    loadSponsorStatuses().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;

    loadRunDetail(selectedRunId).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
    loadReadiness(selectedRunId).catch(() => undefined);

    // SSE drives most updates; the low-cadence poll is a safety net for the list + readiness view.
    const interval = window.setInterval(() => {
      loadRunDetail(selectedRunId).catch(() => undefined);
      loadReadiness(selectedRunId).catch(() => undefined);
      loadRuns().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [selectedRunId]);

  const runStream = useRunStream(selectedRunId);

  useEffect(() => {
    if (!selectedRunId || runStream.progress.length === 0) return;
    loadRunDetail(selectedRunId).catch(() => undefined);
    loadReadiness(selectedRunId).catch(() => undefined);

  }, [selectedRunId, runStream.progress.length]);

  const liveStreamByProvider = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of runStream.liveStreams) {
      map[entry.provider] = entry.streamingUrl;
    }
    return map;
  }, [runStream.liveStreams]);

  const liveSponsors = useMemo(
    () => sponsorStatuses.filter((s) => s.state === 'live').length,
    [sponsorStatuses],
  );

  async function startRun(input: {
    repoUrl: string;
    previewUrl: string;
    baseBranch: string;
    flowGoal: string;
    riskLevel: RiskLevel;
  }) {
    setIsStarting(true);
    setError(undefined);
    setNotice(undefined);
    setIssues([]);

    try {
      const response = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await response.json();

      if (!response.ok) {
        if (Array.isArray(body.issues)) {
          setIssues(body.issues as ValidationIssue[]);
        }
        throw new Error(body.error ?? 'Failed to start run');
      }

      setSelectedRunId(body.run.id);
      setIssues(
        Array.isArray(body.issues)
          ? (body.issues as ValidationIssue[]).filter(
              (issue) => issue.severity === 'warning',
            )
          : [],
      );
      setNotice(
        body.warnings?.length
          ? 'Run created. Review the warnings below — FlowPR will continue but you may want to address them.'
          : 'Run created and queued through Redis.',
      );
      await loadRuns();
      await loadRunDetail(body.run.id);
      await loadReadiness(body.run.id);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : String(startError),
      );
    } finally {
      setIsStarting(false);
    }
  }

  const run = runDetail?.run;
  const tinyfishAgent = runDetail?.browserObservations.find(
    (obs) => obs.provider === 'tinyfish' && !obs.providerRunId?.startsWith('remote-'),
  );
  const tinyfishRemote = runDetail?.browserObservations.find(
    (obs) =>
      obs.provider === 'tinyfish' && obs.providerRunId?.startsWith('remote-'),
  );
  const playwrightLocal = runDetail?.browserObservations.find(
    (obs) => obs.provider === 'playwright',
  );
  const latestHypothesis = runDetail?.bugHypotheses[runDetail.bugHypotheses.length - 1];
  const latestPatch = runDetail?.patches[runDetail.patches.length - 1];
  const latestPr = runDetail?.pullRequests[runDetail.pullRequests.length - 1];

  return (
    <>
      <SiteHeader />

      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-spot" />
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-grid opacity-[0.18]" />

        <div className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <Radio className="h-3 w-3 text-primary" />
                FlowPR · Command Center
              </p>
              <h1 className="font-display text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Frontend QA that{' '}
                <span className="text-primary">ships the patch.</span>
              </h1>
              <p className="mt-4 max-w-2xl text-base text-muted-foreground">
                Describe the journey, point at a preview URL. FlowPR drives a real
                browser, explains what broke, fixes the code, re-verifies, and
                opens a pull request — with live sponsor evidence attached.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/5 px-3 py-1 text-xs text-success">
                  <CheckCircle2 className="h-3 w-3" /> {liveSponsors} sponsor
                  provider{liveSponsors === 1 ? '' : 's'} live
                </div>
                <Link
                  href="/demo"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  View demo <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <SponsorRail
              statuses={sponsorStatuses}
              variant="compact"
              className="max-w-sm"
            />
          </section>

          <DeadLetterStrip className="mb-4" />
          <WorkerStatusNotice className="mb-4" compact />

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Something broke</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {notice && !error && (
            <Alert variant="success" className="mb-4">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          {issues.length > 0 && (
            <Alert variant="warning" className="mb-4">
              <Info className="h-4 w-4" />
              <AlertTitle>Validation notes</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 space-y-1 text-xs">
                  {issues.map((issue, i) => (
                    <li key={`${issue.field}-${i}`}>
                      <span className="font-medium text-foreground">
                        {issue.field}:
                      </span>{' '}
                      {issue.message}
                      {issue.suggestion && (
                        <span className="block pl-4 text-muted-foreground">
                          ↳ {issue.suggestion}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-5">
              <Card>
                <CardHeader className="pb-3">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    New run
                  </p>
                  <p className="text-xl font-semibold tracking-tight">
                    Describe a journey
                  </p>
                </CardHeader>
                <CardContent>
                  <RunForm onStart={startRun} isStarting={isStarting} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Recent runs
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {runs.length} total
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <RunList
                    runs={runs}
                    selectedRunId={selectedRunId}
                    onSelect={setSelectedRunId}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6 lg:col-span-7">
              {run ? (
                <Card className="overflow-hidden">
                  <CardHeader className="space-y-4 border-b border-border/60 bg-card/30">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          Live run
                        </p>
                        <h2 className="mt-1 text-balance text-lg font-semibold leading-snug text-foreground">
                          {run.flowGoal}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitBranch className="h-3 w-3" />
                            {run.owner}/{run.repo}@{run.baseBranch}
                          </span>
                          <span>·</span>
                          <span>{formatDateTime(run.startedAt ?? run.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <StateBadge state={run.status} label={labelRunStatus(run.status)} />
                        <StateBadge state={run.riskLevel} label={labelRiskLevel(run.riskLevel)} />
                        <Button asChild variant="ghost" size="sm" className="text-xs">
                          <Link href={`/runs/${run.id}`}>
                            Full detail <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <PhaseStepper current={run.status} variant="large" />
                  </CardHeader>

                  <CardContent className="p-5">
                    <Tabs defaultValue="evidence" className="w-full">
                      <TabsList>
                        <TabsTrigger value="evidence">Evidence</TabsTrigger>
                        <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
                        <TabsTrigger value="patch">Patch & PR</TabsTrigger>
                        <TabsTrigger value="timeline">Timeline</TabsTrigger>
                        <TabsTrigger value="readiness">Readiness</TabsTrigger>
                      </TabsList>

                      <TabsContent value="evidence" className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-3">
                          <EvidenceCard
                            runId={run.id}
                            observation={tinyfishAgent}
                            label="TinyFish Agent"
                            description="Streaming agent with stealth profile"
                            liveStreamingUrl={liveStreamByProvider.tinyfish}
                          />
                          <EvidenceCard
                            runId={run.id}
                            observation={tinyfishRemote}
                            label="TinyFish Browser"
                            description="Remote CDP session"
                          />
                          <EvidenceCard
                            runId={run.id}
                            observation={playwrightLocal}
                            label="Local Playwright"
                            description="Mobile viewport 390×844"
                          />
                        </div>
                      </TabsContent>

                      <TabsContent value="diagnosis">
                        <DiagnosisCard hypothesis={latestHypothesis} />
                      </TabsContent>

                      <TabsContent value="patch" className="grid gap-4 md:grid-cols-2">
                        <PatchCard patch={latestPatch} />
                        <PrCard pullRequest={latestPr} />
                      </TabsContent>

                      <TabsContent value="timeline">
                        <ScrollArea className="h-[480px] rounded-md border border-border bg-card/30 p-3">
                          <Timeline
                            events={runDetail?.timelineEvents ?? []}
                            emptyLabel="Timeline appears here as FlowPR works."
                          />
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent value="readiness">
                        <ReadinessMeter readiness={readiness} />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-dashed bg-card/40">
                  <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
                    <Radio className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="text-base font-medium text-foreground">
                        Start a run to see it here.
                      </p>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        Fill out the form on the left, or select a recent run to
                        replay it in the command center.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
