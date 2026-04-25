'use client';

import {
  ArrowUpRight,
  Camera,
  CheckCircle2,
  CircleAlert,
  CircleX,
  FileCode2,
  GitPullRequest,
  Hourglass,
  Loader2,
  ShieldAlert,
  Wand2,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import type { RunDetail } from '@flowpr/schemas';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/lib/phase-durations';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'working';

interface OutcomeShape {
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  headline: string;
  subhead: string;
  primaryCta?: { label: string; href: string; external?: boolean };
  secondaryCta?: { label: string; href: string; external?: boolean };
  meta: { label: string; value: ReactNode }[];
}

const ACTIVE_PHASES = new Set([
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
]);

const PHASE_LABELS: Record<string, string> = {
  queued: 'queued',
  loading_repo: 'reading the repository',
  discovering_flows: 'planning the browser flow',
  running_browser_qa: 'driving the live browser',
  collecting_visual_evidence: 'collecting evidence',
  triaging_failure: 'triaging the failure',
  retrieving_policy: 'reading policy + acceptance',
  searching_memory: 'searching prior runs',
  patching_code: 'writing the patch',
  running_local_tests: 'running local checks',
  running_live_verification: 're-driving the browser to verify',
  creating_pr: 'opening the pull request',
  publishing_artifacts: 'publishing the proof bundle',
  learned: 'saving learnings',
};

function deriveOutcome(detail: RunDetail): OutcomeShape {
  const { run } = detail;
  const elapsedMs = run.startedAt
    ? (run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
      new Date(run.startedAt).getTime()
    : 0;
  const duration = elapsedMs > 0 ? formatDurationShort(elapsedMs) : '—';

  const latestPatch = detail.patches[detail.patches.length - 1];
  const latestPR = detail.pullRequests[detail.pullRequests.length - 1];
  const latestHypothesis =
    detail.bugHypotheses[detail.bugHypotheses.length - 1];

  const verifications = detail.verificationResults ?? [];
  const passedCount = verifications.filter((v) => v.status === 'passed').length;
  const failedCount = verifications.filter(
    (v) => v.status === 'failed' || v.status === 'errored',
  ).length;
  const verificationLabel =
    verifications.length === 0
      ? 'no verifications run'
      : `${passedCount} of ${verifications.length} passed`;

  const filesChanged = latestPatch?.filesChanged?.length ?? 0;
  const filesLabel = `${filesChanged} file${filesChanged === 1 ? '' : 's'}`;

  const screenshotCount = detail.browserObservations.filter(
    (o) => o.screenshotKey || o.screenshotUrl,
  ).length;

  const bugSummary =
    latestHypothesis?.summary ??
    latestPatch?.summary ??
    run.failureSummary ??
    'FlowPR drove the live browser, captured evidence, and reasoned about the result.';

  const baseMeta: OutcomeShape['meta'] = [
    { label: 'Duration', value: duration },
    { label: 'Patch', value: filesLabel },
    { label: 'Verifications', value: verificationLabel },
    { label: 'Screenshots', value: `${screenshotCount} captured` },
  ];

  // === active phases ===
  if (ACTIVE_PHASES.has(run.status)) {
    const phaseLabel = PHASE_LABELS[run.status] ?? run.status.replace(/_/g, ' ');
    return {
      tone: 'working',
      icon: Loader2,
      headline: 'FlowPR is working on it…',
      subhead: `Currently ${phaseLabel}.`,
      meta: baseMeta,
    };
  }

  // === failed run ===
  if (run.status === 'failed') {
    return {
      tone: 'danger',
      icon: CircleX,
      headline: 'Run could not complete.',
      subhead:
        run.failureSummary ??
        'FlowPR hit an unrecoverable error. Check the timeline for the failing phase.',
      meta: baseMeta,
    };
  }

  // === done — branch on patch + PR + verification reality ===
  const hasPatch = Boolean(latestPatch);
  const prHasUrl = Boolean(latestPR?.url);
  const prHasNumber = latestPR?.number != null;
  const prMerged = latestPR?.status === 'merged';
  const prBlocked = latestPR && (latestPR.status === 'failed' || latestPR.status === 'closed');

  if (prMerged && prHasUrl) {
    return {
      tone: 'success',
      icon: CheckCircle2,
      headline: `Shipped — PR #${latestPR.number ?? ''} merged.`,
      subhead: bugSummary,
      primaryCta: { label: 'View merged PR', href: latestPR.url!, external: true },
      meta: baseMeta,
    };
  }

  if (prHasUrl && prHasNumber && !prBlocked) {
    return {
      tone: 'success',
      icon: CheckCircle2,
      headline: `Fixed in ${duration} — PR #${latestPR.number} ready to merge.`,
      subhead: bugSummary,
      primaryCta: { label: `View PR #${latestPR.number}`, href: latestPR.url!, external: true },
      meta: baseMeta,
    };
  }

  if (prHasUrl && !prBlocked) {
    return {
      tone: 'success',
      icon: GitPullRequest,
      headline: `Draft PR ready in ${duration}.`,
      subhead: bugSummary,
      primaryCta: { label: 'Open draft PR', href: latestPR!.url!, external: true },
      meta: baseMeta,
    };
  }

  if (hasPatch && prBlocked) {
    return {
      tone: 'warning',
      icon: ShieldAlert,
      headline: 'Patch ready · PR held for human review.',
      subhead: `${bugSummary} The pull request was held by an action gate before it could open.`,
      meta: baseMeta,
    };
  }

  if (hasPatch) {
    return {
      tone: 'info',
      icon: Wand2,
      headline: `Patch ready — ${filesLabel} changed.`,
      subhead: bugSummary,
      meta: baseMeta,
    };
  }

  if (latestHypothesis) {
    return {
      tone: 'info',
      icon: CircleAlert,
      headline: 'Bug confirmed — patch not generated.',
      subhead: bugSummary,
      meta: baseMeta,
    };
  }

  if (screenshotCount > 0) {
    return {
      tone: 'info',
      icon: Camera,
      headline: 'Browser evidence captured.',
      subhead:
        'FlowPR drove the live browser and stored screenshots. No diagnosis was reached on this run.',
      meta: baseMeta,
    };
  }

  return {
    tone: 'info',
    icon: Hourglass,
    headline: 'Run finished without a definitive result.',
    subhead: bugSummary,
    meta: baseMeta,
  };
}

const TONE_STYLES: Record<
  Tone,
  { card: string; icon: string; iconWrap: string; cta: string; pill: string }
> = {
  success: {
    card: 'border-success/40 bg-success/5',
    icon: 'text-success',
    iconWrap: 'border-success/40 bg-success/10 text-success',
    cta: '',
    pill: 'border-success/40 bg-success/10 text-success',
  },
  warning: {
    card: 'border-warning/40 bg-warning/5',
    icon: 'text-warning',
    iconWrap: 'border-warning/40 bg-warning/10 text-warning',
    cta: '',
    pill: 'border-warning/40 bg-warning/10 text-warning',
  },
  danger: {
    card: 'border-destructive/40 bg-destructive/5',
    icon: 'text-destructive',
    iconWrap: 'border-destructive/40 bg-destructive/10 text-destructive',
    cta: '',
    pill: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  info: {
    card: 'border-primary/30 bg-primary/5',
    icon: 'text-primary',
    iconWrap: 'border-primary/40 bg-primary/10 text-primary',
    cta: '',
    pill: 'border-primary/40 bg-primary/10 text-primary',
  },
  working: {
    card: 'border-primary/30 bg-primary/5',
    icon: 'text-primary',
    iconWrap: 'border-primary/40 bg-primary/10 text-primary',
    cta: '',
    pill: 'border-primary/40 bg-primary/10 text-primary',
  },
};

export function OutcomeHero({ detail }: { detail: RunDetail }) {
  const outcome = deriveOutcome(detail);
  const styles = TONE_STYLES[outcome.tone];
  const Icon = outcome.icon;
  const isWorking = outcome.tone === 'working';

  return (
    <Card className={cn('overflow-hidden', styles.card)}>
      <CardContent className="flex flex-col gap-5 p-6 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-5">
          <div
            className={cn(
              'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border',
              styles.iconWrap,
            )}
          >
            <Icon className={cn('h-7 w-7', isWorking && 'animate-spin')} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Outcome
            </p>
            <h2 className="mt-1 font-display text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {outcome.headline}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {outcome.subhead}
            </p>
          </div>
          {outcome.primaryCta && (
            <div className="flex shrink-0 gap-2 md:self-center">
              <Button asChild size="lg">
                <a
                  href={outcome.primaryCta.href}
                  target={outcome.primaryCta.external ? '_blank' : undefined}
                  rel={outcome.primaryCta.external ? 'noreferrer' : undefined}
                >
                  {outcome.primaryCta.label}
                  {outcome.primaryCta.external && (
                    <ArrowUpRight className="h-4 w-4" />
                  )}
                </a>
              </Button>
              {outcome.secondaryCta && (
                <Button asChild variant="outline" size="lg">
                  <a
                    href={outcome.secondaryCta.href}
                    target={outcome.secondaryCta.external ? '_blank' : undefined}
                    rel={outcome.secondaryCta.external ? 'noreferrer' : undefined}
                  >
                    {outcome.secondaryCta.label}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border/40 pt-4 md:grid-cols-4 md:gap-4">
          {outcome.meta.map((m) => (
            <div key={m.label}>
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80">
                {m.label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {detail.patches.length > 0 && detail.patches[0]?.filesChanged?.length ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileCode2 className="h-3.5 w-3.5" />
            <span className="text-foreground/80">Files touched:</span>
            {(detail.patches[detail.patches.length - 1]?.filesChanged ?? [])
              .slice(0, 4)
              .map((f, i) => {
                const path = (f as Record<string, unknown>).path as string | undefined;
                if (!path) return null;
                return (
                  <code
                    key={`${path}-${i}`}
                    className="rounded border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80"
                  >
                    {path}
                  </code>
                );
              })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
