'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  Cpu,
  Key,
  Loader2,
  Radio,
  Siren,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { SiteHeader } from '@/components/flowpr/site-header';
import { MetricTile } from '@/components/flowpr/metric-tile';
import { StateBadge } from '@/components/flowpr/state-badge';
import { SponsorRail, type SponsorStatus } from '@/components/flowpr/sponsor-rail';
import { cn } from '@/lib/utils';
import { formatRelativeTime, prettifyKey } from '@/lib/format';

type EnvState = 'configured' | 'missing' | 'partial' | 'local_artifact';

interface HealthResponse {
  envReadiness: Record<string, EnvState>;
  sponsorStatuses: SponsorStatus[];
  sponsorError?: string;
  streams: string[];
  generatedAt: string;
}

interface WorkerStatus {
  workerId: string;
  lastBeat: string;
  pid?: string;
  processed?: number;
  currentRunId?: string;
  currentPhase?: string;
  ageMs: number;
  alive: boolean;
}

interface WorkerStatusResponse {
  workers: WorkerStatus[];
  aliveCount: number;
  generatedAt: string;
  error?: string;
}

interface DeadLetterEntry {
  id: string;
  runId: string;
  sourceStream?: string;
  eventType?: string;
  phase?: string;
  attempt?: number;
  error?: string;
  createdAt?: string;
}

interface DeadLetterResponse {
  entries: DeadLetterEntry[];
  count: number;
  generatedAt: string;
  error?: string;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [workers, setWorkers] = useState<WorkerStatusResponse | null>(null);
  const [deadLetter, setDeadLetter] = useState<DeadLetterResponse | null>(null);
  const [error, setError] = useState<string>();

  async function load() {
    setError(undefined);
    const [healthResponse, workersResponse, deadLetterResponse] = await Promise.all([
      fetch('/api/health', { cache: 'no-store' }),
      fetch('/api/workers/status', { cache: 'no-store' }),
      fetch('/api/dead-letter?count=20', { cache: 'no-store' }),
    ]);
    const body = await healthResponse.json();
    if (!healthResponse.ok) {
      setError(body.error ?? `Health endpoint returned ${healthResponse.status}`);
      return;
    }
    setData(body);
    if (workersResponse.ok) {
      setWorkers(await workersResponse.json());
    }
    if (deadLetterResponse.ok) {
      setDeadLetter(await deadLetterResponse.json());
    }
  }

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const counts = useMemo(() => {
    if (!data) return { configured: 0, partial: 0, missing: 0, envTotal: 0, sponsorsLive: 0 };
    const envEntries = Object.values(data.envReadiness);
    return {
      envTotal: envEntries.length,
      configured: envEntries.filter((s) => s === 'configured').length,
      partial: envEntries.filter((s) => s === 'partial' || s === 'local_artifact').length,
      missing: envEntries.filter((s) => s === 'missing').length,
      sponsorsLive: data.sponsorStatuses.filter((s) => s.state === 'live').length,
    };
  }, [data]);

  return (
    <>
      <SiteHeader />
      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot opacity-60" />

        <div className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <Activity className="h-3 w-3 text-primary" /> System health
              </p>
              <h1 className="font-display text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Provider readiness
              </h1>
              {data && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Generated {formatRelativeTime(data.generatedAt)} ·{' '}
                  <span className="font-mono">{new Date(data.generatedAt).toLocaleTimeString()}</span>
                </p>
              )}
            </div>
          </section>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Health check failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!data && !error && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pinging providers…
            </div>
          )}

          {data && (
            <>
              <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricTile
                  label="Env configured"
                  value={`${counts.configured}/${counts.envTotal}`}
                  tone={counts.missing === 0 ? 'success' : 'warning'}
                  icon={<Key className="h-5 w-5" />}
                  caption={counts.missing > 0 ? `${counts.missing} missing` : 'All required keys present'}
                />
                <MetricTile
                  label="Sponsors live"
                  value={counts.sponsorsLive}
                  tone={counts.sponsorsLive > 0 ? 'success' : 'muted'}
                  icon={<Radio className="h-5 w-5" />}
                  caption={`${data.sponsorStatuses.length} checked`}
                />
                <MetricTile
                  label="Redis streams"
                  value={data.streams.length}
                  tone={data.streams.length > 0 ? 'success' : 'danger'}
                  icon={<Box className="h-5 w-5" />}
                  caption={data.streams.length > 0 ? 'Consumer groups OK' : 'No streams detected'}
                />
                <MetricTile
                  label="Workers alive"
                  value={workers?.aliveCount ?? 0}
                  tone={
                    workers === null ? 'muted' : workers.aliveCount > 0 ? 'success' : 'danger'
                  }
                  icon={<Cpu className="h-5 w-5" />}
                  caption={
                    workers && workers.workers.length > 0
                      ? `${workers.workers.length} tracked`
                      : 'No heartbeats seen'
                  }
                />
                <MetricTile
                  label="Last check"
                  value={formatRelativeTime(data.generatedAt)}
                  tone="info"
                  icon={<Clock className="h-5 w-5" />}
                  caption="Auto-refresh every 15s"
                />
              </section>

              {deadLetter && deadLetter.entries.length > 0 && (
                <Card className="mb-6 border-destructive/40 bg-destructive/5">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-destructive">
                        <Siren className="h-4 w-4" /> Dead letter
                      </CardTitle>
                      <span className="text-[11px] text-muted-foreground">
                        {deadLetter.count} entries
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Events the worker couldn&apos;t process after 3 attempts. These runs are stuck.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {deadLetter.entries.slice(0, 8).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-start justify-between gap-3 rounded-md border border-destructive/20 bg-card/60 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground">
                              {entry.phase ? entry.phase.replace(/_/g, ' ') : entry.eventType ?? 'unknown'}
                              {entry.attempt && ` · attempt ${entry.attempt}`}
                            </p>
                            {entry.error && (
                              <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-destructive">
                                {entry.error}
                              </p>
                            )}
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {entry.sourceStream}
                              {entry.createdAt && ` · ${formatRelativeTime(entry.createdAt)}`}
                            </p>
                          </div>
                          {entry.runId && (
                            <Link
                              href={`/runs/${entry.runId}`}
                              className="shrink-0 self-center font-mono text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            >
                              {entry.runId.slice(0, 8)}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {workers && workers.workers.length > 0 && (
                <Card className="mb-6">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Workers
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Redis heartbeats from the consumer group. Dead workers drop off after 15s.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {workers.workers.map((worker) => (
                        <li
                          key={worker.workerId}
                          className="flex items-start justify-between gap-3 rounded-md border border-border bg-card/40 p-3"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-foreground">{worker.workerId}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              last beat {formatRelativeTime(worker.lastBeat)}
                              {typeof worker.processed !== 'undefined' && ` · ${worker.processed} processed`}
                            </p>
                            {worker.currentRunId && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                on run {worker.currentRunId.slice(0, 8)}
                                {worker.currentPhase && ` · ${worker.currentPhase.replace(/_/g, ' ')}`}
                              </p>
                            )}
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                              worker.alive
                                ? 'border-success/30 bg-success/10 text-success'
                                : 'border-destructive/30 bg-destructive/10 text-destructive'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                worker.alive ? 'animate-pulse bg-success' : 'bg-destructive'
                              }`}
                            />
                            {worker.alive ? 'alive' : 'stale'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Environment
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Required credentials for the run loop.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {Object.entries(data.envReadiness).map(([key, state]) => (
                        <EnvRow key={key} name={key} state={state} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Sponsor checks
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Live pings against each sponsor provider.
                    </p>
                  </CardHeader>
                  <CardContent>
                    {data.sponsorError ? (
                      <Alert variant="destructive">
                        <AlertDescription>{data.sponsorError}</AlertDescription>
                      </Alert>
                    ) : (
                      <SponsorRail statuses={data.sponsorStatuses} variant="full" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Redis streams
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Event backbone for the state machine.
                    </p>
                  </CardHeader>
                  <CardContent>
                    {data.streams.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                        No streams detected.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {data.streams.map((stream) => (
                          <li
                            key={stream}
                            className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
                          >
                            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                            <code className="font-mono text-[11px] text-muted-foreground">
                              {stream}
                            </code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function EnvRow({ name, state }: { name: string; state: EnvState }) {
  const Icon =
    state === 'configured' ? CheckCircle2 : state === 'missing' ? XCircle : AlertTriangle;
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            state === 'configured' && 'text-success',
            state === 'missing' && 'text-destructive',
            (state === 'partial' || state === 'local_artifact') && 'text-warning',
          )}
        />
        <span className="truncate font-mono text-xs text-foreground">{prettifyKey(name)}</span>
      </div>
      <StateBadge state={state} dot={false} />
    </li>
  );
}
