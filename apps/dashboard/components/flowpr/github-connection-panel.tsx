'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Github, GitPullRequest, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { formatRelativeTime } from '@/lib/format';

type ConnectionState = 'ready' | 'setup_needed';

interface GitHubConnectionStatus {
  authProvider: ConnectionState;
  repositoryAccess: ConnectionState;
  connectionStore: ConnectionState;
  connectionCount?: number;
  latestConnection?: {
    state: string;
    updatedAt: string;
  };
  startUrl: string;
  summaries: {
    authProvider: string;
    repositoryAccess: string;
    connectionStore: string;
  };
}

function stateLabel(state: ConnectionState) {
  return state === 'ready' ? 'Ready' : 'Setup needed';
}

export function GitHubConnectionPanel() {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      const response = await fetch('/api/connections/github/status', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to load GitHub connection status');
      setStatus(body);
    }

    load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
              <Github className="h-4 w-4 text-primary" /> GitHub connection
            </CardTitle>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Let users sign in with GitHub through InsForge, then connect repository
              access for FlowPR runs.
            </p>
          </div>
          <Button asChild size="sm">
            <a href={status?.startUrl ?? '/api/connections/github/start'}>
              <Github className="h-3.5 w-3.5" /> Connect GitHub
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!status && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking connection path…
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {status && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border bg-card/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Sign-in
                </p>
                <StateBadge state={status.authProvider} label={stateLabel(status.authProvider)} />
              </div>
              <p className="text-xs text-muted-foreground">{status.summaries.authProvider}</p>
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <GitPullRequest className="h-3.5 w-3.5 text-primary" /> Repository access
                </p>
                <StateBadge
                  state={status.repositoryAccess}
                  label={stateLabel(status.repositoryAccess)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{status.summaries.repositoryAccess}</p>
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Saved connections
                </p>
                <StateBadge
                  state={status.connectionStore}
                  label={stateLabel(status.connectionStore)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {typeof status.connectionCount === 'number'
                  ? `${status.connectionCount} GitHub connection${status.connectionCount === 1 ? '' : 's'} recorded in InsForge.`
                  : status.summaries.connectionStore}
              </p>
              {status.latestConnection && (
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Latest {status.latestConnection.state.replace(/_/g, ' ')}{' '}
                  {formatRelativeTime(status.latestConnection.updatedAt)}.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
