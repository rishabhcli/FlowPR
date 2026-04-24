'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCheck,
  CircleX,
  Cloud,
  Clock,
  Cpu,
  Database,
  Gauge,
  Github,
  Loader2,
  Network,
  PackageCheck,
  Radio,
  Rocket,
  ShieldCheck,
  Siren,
  Timer,
  Workflow,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { SiteHeader } from '@/components/flowpr/site-header';
import { MetricTile } from '@/components/flowpr/metric-tile';
import { StateBadge } from '@/components/flowpr/state-badge';
import { SponsorRail, type SponsorStatus } from '@/components/flowpr/sponsor-rail';
import { GitHubConnectionPanel } from '@/components/flowpr/github-connection-panel';
import { ActivityFeed } from '@/components/flowpr/activity-feed';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { formatDurationShort } from '@/lib/phase-durations';
import { useObservabilitySummary } from '@/lib/use-observability';

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

const integrationOrder = [
  'github',
  'insforge',
  'redis',
  'tinyfish',
  'senso',
  'guildai',
  'shipables',
  'wundergraph',
  'akash',
  'chainguard',
];

const optionalIntegrations = new Set(['wundergraph', 'akash', 'chainguard']);

const integrationCopy: Record<
  string,
  {
    label: string;
    description: string;
    capability: string;
  }
> = {
  github: {
    label: 'GitHub',
    description: 'Connects customer repositories, branches, and pull requests.',
    capability: 'Repository access',
  },
  insforge: {
    label: 'InsForge',
    description: 'Stores runs, evidence, auth sessions, and connection records.',
    capability: 'System of record',
  },
  redis: {
    label: 'Redis',
    description: 'Keeps run queues, worker locks, progress, and short-term memory moving.',
    capability: 'Run queue',
  },
  tinyfish: {
    label: 'TinyFish',
    description: 'Runs live browser sessions against the customer preview.',
    capability: 'Browser QA',
  },
  senso: {
    label: 'Senso',
    description: 'Adds policy and acceptance context before diagnosis and PR writing.',
    capability: 'Policy context',
  },
  guildai: {
    label: 'Guild.ai',
    description: 'Gates high-impact actions before patching and PR creation.',
    capability: 'Action gates',
  },
  shipables: {
    label: 'Shipables',
    description: 'Packages the FlowPR skill and proof bundle for delivery.',
    capability: 'Skill package',
  },
  wundergraph: {
    label: 'WunderGraph',
    description: 'Routes controlled backend operations when a safe operation is available.',
    capability: 'Safe operations',
  },
  akash: {
    label: 'Akash',
    description: 'Supports hosted runtime deployment when enabled for this workspace.',
    capability: 'Deployment',
  },
  chainguard: {
    label: 'Chainguard',
    description: 'Supports container hardening and runtime packaging checks.',
    capability: 'Container path',
  },
};

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [workers, setWorkers] = useState<WorkerStatusResponse | null>(null);
  const [deadLetter, setDeadLetter] = useState<DeadLetterResponse | null>(null);
  const [error, setError] = useState<string>();
  const observability = useObservabilitySummary({ intervalMs: 10000 });

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
    if (!data) {
      return {
        ready: 0,
        coreTotal: 0,
        needsSetup: 0,
        optionalAvailable: 0,
        sponsorsLive: 0,
      };
    }
    const coreEntries = Object.entries(data.envReadiness).filter(
      ([key]) => !optionalIntegrations.has(key),
    );
    const optionalEntries = Object.entries(data.envReadiness).filter(([key]) =>
      optionalIntegrations.has(key),
    );
    return {
      coreTotal: coreEntries.length,
      ready: coreEntries.filter(([, state]) =>
        state === 'configured' || state === 'local_artifact',
      ).length,
      needsSetup: coreEntries.filter(([, state]) =>
        state === 'missing' || state === 'partial',
      ).length,
      optionalAvailable: optionalEntries.filter(([, state]) => state !== 'missing').length,
      sponsorsLive: data.sponsorStatuses.filter((s) => s.state === 'live').length,
    };
  }, [data]);

  const integrationRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.envReadiness).sort(([a], [b]) => {
      const ai = integrationOrder.indexOf(a);
      const bi = integrationOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
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
                Workspace connections
              </h1>
              {data && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Refreshed {formatRelativeTime(data.generatedAt)} ·{' '}
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
              <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace connections…
            </div>
          )}

          {data && (
            <>
              <section className="mb-6">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                    <div>
                      <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                        Run throughput · last 24h
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        How the autonomous loop has performed since this time yesterday.
                      </p>
                    </div>
                    {observability.data?.runs.error && (
                      <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning">
                        partial data
                      </span>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <MetricTile
                        label="Runs / 24h"
                        value={observability.data?.runs.total24h ?? 0}
                        tone="info"
                        icon={<Gauge className="h-4 w-4" />}
                        caption={
                          observability.data
                            ? `${observability.data.runs.active} active · ${observability.data.runs.queued} queued`
                            : 'awaiting data'
                        }
                      />
                      <MetricTile
                        label="Done"
                        value={observability.data?.runs.done24h ?? 0}
                        tone="success"
                        icon={<CheckCheck className="h-4 w-4" />}
                        caption={
                          observability.data?.runs.successRate24h != null
                            ? `${Math.round(observability.data.runs.successRate24h * 100)}% success rate`
                            : 'no completed runs yet'
                        }
                      />
                      <MetricTile
                        label="Failed"
                        value={observability.data?.runs.failed24h ?? 0}
                        tone={
                          (observability.data?.runs.failed24h ?? 0) > 0
                            ? 'danger'
                            : 'muted'
                        }
                        icon={<CircleX className="h-4 w-4" />}
                        caption={
                          (observability.data?.runs.failed24h ?? 0) > 0
                            ? 'review the dead-letter queue'
                            : 'no failed runs'
                        }
                      />
                      <MetricTile
                        label="Mean duration"
                        value={
                          observability.data?.runs.meanDurationMs != null
                            ? formatDurationShort(
                                observability.data.runs.meanDurationMs,
                              )
                            : '—'
                        }
                        tone="info"
                        icon={<Timer className="h-4 w-4" />}
                        caption="successful runs only"
                      />
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricTile
                  label="Core ready"
                  value={`${counts.ready}/${counts.coreTotal}`}
                  tone={counts.needsSetup === 0 ? 'success' : 'warning'}
                  icon={<ShieldCheck className="h-5 w-5" />}
                  caption={
                    counts.needsSetup > 0
                      ? `${counts.needsSetup} connection${counts.needsSetup === 1 ? '' : 's'} need setup`
                      : 'Ready for autonomous runs'
                  }
                />
                <MetricTile
                  label="Live checks"
                  value={counts.sponsorsLive}
                  tone={counts.sponsorsLive > 0 ? 'success' : 'muted'}
                  icon={<Radio className="h-5 w-5" />}
                  caption={`${data.sponsorStatuses.length} integrations checked`}
                />
                <MetricTile
                  label="State streams"
                  value={data.streams.length}
                  tone={data.streams.length > 0 ? 'success' : 'danger'}
                  icon={<Box className="h-5 w-5" />}
                  caption={data.streams.length > 0 ? 'Events are flowing' : 'No streams detected'}
                />
                <MetricTile
                  label="Workers"
                  value={workers?.aliveCount ?? 0}
                  tone={
                    workers === null ? 'muted' : workers.aliveCount > 0 ? 'success' : 'danger'
                  }
                  icon={<Cpu className="h-5 w-5" />}
                  caption={
                    workers && workers.workers.length > 0
                      ? `${workers.workers.length} tracked`
                      : 'Start a worker to process queued runs'
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

              <section className="mb-6">
                <GitHubConnectionPanel />
              </section>

              {deadLetter && deadLetter.entries.length > 0 && (
                <Card className="mb-6 border-destructive/40 bg-destructive/5">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-destructive">
                        <Siren className="h-4 w-4" /> Attention queue
                      </CardTitle>
                      <span className="text-[11px] text-muted-foreground">
                        {deadLetter.count} entries
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Events that need an operator look before the run can continue cleanly.
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
                      Platform connections
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      What FlowPR can use for customer-facing runs.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {integrationRows.map(([key, state]) => (
                        <IntegrationRow key={key} name={key} state={state} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                      Integration checks
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Recent live checks against the services FlowPR can use.
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
                      Event backbone for runs, workers, evidence, and verification.
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

              <section className="mt-6">
                <ActivityFeed
                  title="Live event tail"
                  subtitle="Latest worker, browser, and provider events across recent runs."
                  height={320}
                />
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function integrationIcon(name: string) {
  if (name === 'github') return Github;
  if (name === 'insforge') return Database;
  if (name === 'redis') return Box;
  if (name === 'tinyfish') return Radio;
  if (name === 'senso') return ShieldCheck;
  if (name === 'guildai') return Workflow;
  if (name === 'shipables') return PackageCheck;
  if (name === 'wundergraph') return Network;
  if (name === 'akash') return Cloud;
  if (name === 'chainguard') return Rocket;
  return Activity;
}

function integrationStateLabel(name: string, state: EnvState) {
  if (state === 'configured') return 'Ready';
  if (state === 'local_artifact') return 'Local mode';
  if (optionalIntegrations.has(name) && state === 'missing') {
    return 'Available after setup';
  }
  if (state === 'partial') return 'Needs setup';
  return 'Setup needed';
}

function integrationToneState(name: string, state: EnvState) {
  if (state === 'configured') return 'configured';
  if (state === 'local_artifact') return 'local_artifact';
  if (optionalIntegrations.has(name) && state === 'missing') return 'not_configured';
  return state;
}

function IntegrationRow({ name, state }: { name: string; state: EnvState }) {
  const Icon = integrationIcon(name);
  const copy = integrationCopy[name] ?? {
    label: name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    description: 'Workspace integration.',
    capability: 'Integration',
  };

  return (
    <li className="rounded-md border border-border bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
        <Icon
          className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
            state === 'configured' && 'text-success',
              state === 'missing' && !optionalIntegrations.has(name) && 'text-warning',
            (state === 'partial' || state === 'local_artifact') && 'text-warning',
              optionalIntegrations.has(name) && state === 'missing' && 'text-muted-foreground',
          )}
        />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{copy.label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {copy.description}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {copy.capability}
            </p>
          </div>
      </div>
        <StateBadge
          state={integrationToneState(name, state)}
          label={integrationStateLabel(name, state)}
          dot={false}
          className="shrink-0"
        />
      </div>
    </li>
  );
}
