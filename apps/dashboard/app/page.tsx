'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Radio, Search, SlidersHorizontal, X } from 'lucide-react';
import type { FlowPrRun, FlowProfile, PermissionProfile, RiskLevel, RunDetail } from '@flowpr/schemas';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { SiteHeader } from '@/components/flowpr/site-header';
import { RunForm } from '@/components/flowpr/run-form';
import { RunList } from '@/components/flowpr/run-list';
import { RunPulse } from '@/components/flowpr/run-pulse';
import { ActivityFeed } from '@/components/flowpr/activity-feed';
import { SystemStatusBar } from '@/components/flowpr/system-status-bar';
import { ProfileLibrary } from '@/components/flowpr/profile-library';
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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [totalRuns, setTotalRuns] = useState(0);

  async function loadRuns(filters = { query, statusFilter, riskFilter }) {
    const params = new URLSearchParams();
    if (filters.query.trim()) params.set('q', filters.query.trim());
    if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);
    if (filters.riskFilter !== 'all') params.set('risk', filters.riskFilter);
    params.set('limit', '60');
    const response = await fetch(`/api/runs?${params.toString()}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load runs');
    setRuns(body.runs);
    setTotalRuns(typeof body.total === 'number' ? body.total : body.runs.length);
    const selectedStillVisible = body.runs.some((run: FlowPrRun) => run.id === selectedRunId);
    if (!selectedStillVisible) {
      setRunDetail(null);
      setSelectedRunId(body.runs[0]?.id);
    }
  }

  async function loadRunDetail(runId: string) {
    const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Failed to load run detail');
    setRunDetail(body);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadRuns({ query, statusFilter, riskFilter }).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, statusFilter, riskFilter]);

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
    permissionProfile: PermissionProfile;
  }, profileId?: string) {
    setIsStarting(true);
    setError(undefined);
    setNotice(undefined);
    setIssues([]);

    try {
      const response = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileId ? { profileId } : input),
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
          ? 'Run created. Review the runtime notes below before relying on worker execution.'
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

  async function runProfile(profile: FlowProfile) {
    await startRun({
      repoUrl: profile.repoUrl,
      previewUrl: profile.previewUrl,
      baseBranch: profile.baseBranch,
      flowGoal: profile.flowGoal,
      riskLevel: profile.riskLevel,
      permissionProfile: profile.permissionProfile,
    }, profile.id);
  }

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setRiskFilter('all');
  }

  return (
    <>
      <SiteHeader />

      <main className="relative">
        <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-radial-spot" />

        <div className="mx-auto max-w-7xl px-6 py-8">
          <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <Radio className="h-3 w-3 text-primary" />
                Command Center
              </p>
              <h1 className="font-display text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Make every user journey{' '}
                <span className="text-primary">release-ready.</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Run browser proof from a saved playbook or describe a one-off journey. Every observation, decision, patch, and verification stays attached to the run.
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <ProfileLibrary onRun={runProfile} busy={isStarting} />
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

            </div>

            <div className="min-w-0 space-y-6">
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

          <section className="mt-8 border-t border-border/70 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Run history</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Evidence across this workspace</h2>
                <p className="mt-1 text-xs text-muted-foreground">Search the persisted run index by journey, repository, state, or risk.</p>
              </div>
              <p className="text-xs text-muted-foreground">{totalRuns} matching {totalRuns === 1 ? 'run' : 'runs'}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[min(100%,22rem)] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search journey, repo, preview URL…" className="pl-9" aria-label="Search run history" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="queued">Queued</SelectItem><SelectItem value="running_browser_qa">Browser QA</SelectItem><SelectItem value="patching_code">Patching</SelectItem><SelectItem value="done">Done</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger className="w-[130px]" aria-label="Filter by risk"><SelectValue placeholder="Risk" /></SelectTrigger><SelectContent><SelectItem value="all">All risk</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select>
              {(query || statusFilter !== 'all' || riskFilter !== 'all') && <Button type="button" variant="ghost" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear</Button>}
            </div>
            <div className="mt-4">
              <RunList runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} maxItems={60} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
