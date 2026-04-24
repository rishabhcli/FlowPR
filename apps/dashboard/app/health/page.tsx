'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  Key,
  Loader2,
  Radio,
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

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string>();

  async function load() {
    setError(undefined);
    const response = await fetch('/api/health', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? `Health endpoint returned ${response.status}`);
      return;
    }
    setData(body);
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
              <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  label="Last check"
                  value={formatRelativeTime(data.generatedAt)}
                  tone="info"
                  icon={<Clock className="h-5 w-5" />}
                  caption="Auto-refresh every 15s"
                />
              </section>

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
