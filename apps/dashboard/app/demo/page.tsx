'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleDashed,
  CircleDot,
  Film,
} from 'lucide-react';
import type { FlowPrRun, RunDetail, RunStatus } from '@flowpr/schemas';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

import { SiteHeader } from '@/components/flowpr/site-header';
import { RunPulse } from '@/components/flowpr/run-pulse';
import { Timeline } from '@/components/flowpr/timeline';
import {
  ReadinessMeter,
  type ReadinessSummary,
} from '@/components/flowpr/readiness-meter';
import { useRunStream } from '@/lib/use-run-stream';
import { cn } from '@/lib/utils';

interface ReadinessResponse extends ReadinessSummary {
  runId: string;
}

const DEMO_SCRIPT: Array<{ step: string; phaseGate: RunStatus }> = [
  { step: 'Show broken checkout on mobile viewport.', phaseGate: 'queued' },
  { step: 'Start the FlowPR run.', phaseGate: 'loading_repo' },
  { step: 'Highlight TinyFish live failure evidence.', phaseGate: 'running_browser_qa' },
  { step: 'Show Senso policy + Redis memory triage.', phaseGate: 'retrieving_policy' },
  { step: 'Open the Guild.ai gate + patch + regression test.', phaseGate: 'patching_code' },
  { step: 'Confirm local verification and TinyFish after-fix.', phaseGate: 'running_live_verification' },
  { step: 'Open the GitHub PR body.', phaseGate: 'creating_pr' },
  { step: 'Point to the evidence packet and session trace.', phaseGate: 'publishing_artifacts' },
];

const phaseOrder: RunStatus[] = [
  'queued',
  'loading_repo',
  'discovering_flows',
  'running_browser_qa',
  'collecting_visual_evidence',
  'triaging_failure',
  'retrieving_policy',
  'searching_memory',
  'patching_code',
  'running_local_tests',
  'running_live_verification',
  'creating_pr',
  'publishing_artifacts',
  'learned',
  'done',
];

export default function DemoPage() {
  const [runs, setRuns] = useState<FlowPrRun[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string>();

  async function loadRunList() {
    const response = await fetch('/api/runs', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load runs');
    const nextRuns = body.runs as FlowPrRun[];
    setRuns(nextRuns);
    if (nextRuns.length === 0) return null;
    return nextRuns[0].id;
  }

  async function loadDetail(runId: string) {
    const [detailResponse, readinessResponse] = await Promise.all([
      fetch(`/api/runs/${runId}`, { cache: 'no-store' }),
      fetch(`/api/runs/${runId}/readiness`, { cache: 'no-store' }),
    ]);
    if (detailResponse.ok) setDetail(await detailResponse.json());
    if (readinessResponse.ok) setReadiness(await readinessResponse.json());
  }

  useEffect(() => {
    async function tick() {
      try {
        const latestRunId = await loadRunList();
        if (latestRunId) await loadDetail(latestRunId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    tick();
    const interval = window.setInterval(tick, 4000);
    return () => window.clearInterval(interval);
  }, []);

  const runStream = useRunStream(detail?.run.id);

  const currentPhaseIndex = useMemo(() => {
    if (!detail) return -1;
    return phaseOrder.indexOf(detail.run.status);
  }, [detail]);

  return (
    <>
      <SiteHeader />
      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot opacity-70" />

        <div className="mx-auto max-w-7xl px-6 py-8">
          <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <Film className="h-3 w-3 text-primary" /> Demo · Presenter view
              </p>
              <h1 className="font-display text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Autonomous browser QA, on the record.
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Three-minute walkthrough. Every tile is driven by real run state —
                browser evidence, patch, PR, and verification.
              </p>
            </div>
          </section>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!detail && !error && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
                <Film className="h-8 w-8 text-muted-foreground" />
                <p className="text-base font-medium">No run to demo yet.</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Head to the <Link href="/" className="text-primary underline-offset-4 hover:underline">command center</Link>{' '}
                  and start a run — this page will begin auto-playing.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/">
                    Start a run <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {detail && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                <RunPulse
                  detail={detail}
                  progress={runStream.progress}
                  liveStreams={runStream.liveStreams}
                  connected={runStream.connected}
                />

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Activity
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {detail.timelineEvents.length} events
                    </span>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[320px] px-5 pb-5">
                      <Timeline events={detail.timelineEvents} />
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Presenter script
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Auto-ticks as phases complete.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {DEMO_SCRIPT.map((item, index) => {
                      const gateIndex = phaseOrder.indexOf(item.phaseGate);
                      const done = currentPhaseIndex > gateIndex;
                      const active = currentPhaseIndex === gateIndex;
                      const Icon = done ? Check : active ? CircleDot : CircleDashed;
                      return (
                        <div
                          key={item.step}
                          className={cn(
                            'flex items-start gap-2 rounded-md border p-2.5 text-xs transition-all',
                            done && 'border-success/30 bg-success/5 text-muted-foreground',
                            active && 'border-primary/50 bg-primary/5 text-foreground',
                            !done && !active && 'border-border text-muted-foreground',
                          )}
                        >
                          <Icon
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0',
                              done && 'text-success',
                              active && 'animate-pulse text-primary',
                              !done && !active && 'text-muted-foreground/60',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              {index + 1}
                            </span>
                            <span className="leading-relaxed">{item.step}</span>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <ReadinessMeter readiness={readiness} />
              </aside>
            </div>
          )}

          {runs.length > 1 && (
            <p className="mt-8 text-xs text-muted-foreground">
              Tracking latest run · {runs.length} total recent runs.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
