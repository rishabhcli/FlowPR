'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Radio } from 'lucide-react';
import type { FlowPrRun, RiskLevel, RunDetail } from '@flowpr/schemas';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

import { SiteHeader } from '@/components/flowpr/site-header';
import { RunForm } from '@/components/flowpr/run-form';
import { RunList } from '@/components/flowpr/run-list';
import { RunPulse } from '@/components/flowpr/run-pulse';
import { ActivityFeed } from '@/components/flowpr/activity-feed';
import { SystemStatusBar } from '@/components/flowpr/system-status-bar';
import { useRunStream } from '@/lib/use-run-stream';

interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<FlowPrRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
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

  async function loadRunDetail(runId: string) {
    const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load run detail');
    setRunDetail(body);
  }

  useEffect(() => {
    loadRuns().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;

    loadRunDetail(selectedRunId).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });

    // SSE drives most updates; the low-cadence poll is a safety net.
    const interval = window.setInterval(() => {
      loadRunDetail(selectedRunId).catch(() => undefined);
      loadRuns().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [selectedRunId]);

  const runStream = useRunStream(selectedRunId);

  useEffect(() => {
    if (!selectedRunId || runStream.progress.length === 0) return;
    loadRunDetail(selectedRunId).catch(() => undefined);
  }, [selectedRunId, runStream.progress.length]);

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
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : String(startError),
      );
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <>
      <SiteHeader />

      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot" />

        <div className="mx-auto max-w-7xl px-6 py-8">
          <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <Radio className="h-3 w-3 text-primary" />
                Command Center
              </p>
              <h1 className="font-display text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Frontend QA that{' '}
                <span className="text-primary">ships the patch.</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Describe a journey, point at a preview URL. FlowPR drives the
                browser, explains the failure, opens a fix, re-verifies, and
                ships a PR.
              </p>
            </div>
            <SystemStatusBar variant="panel" className="sm:hidden" />
          </section>

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
            <div className="space-y-6 lg:col-span-4">
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
                <CardHeader className="pb-3">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Recent runs
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {runs.length} total
                  </p>
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

            <div className="space-y-6 lg:col-span-8">
              <RunPulse
                detail={runDetail}
                progress={runStream.progress}
                liveStreams={runStream.liveStreams}
                connected={runStream.connected}
              />
              <ActivityFeed
                title="System activity"
                subtitle="Latest events across every run on this workspace."
                height={300}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
