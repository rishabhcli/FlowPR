'use client';

import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, GitMerge, GitPullRequest, Loader2 } from 'lucide-react';
import type { PullRequestRecord } from '@flowpr/schemas';
import { labelPullRequestStatus } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';

interface PrCardProps {
  pullRequest?: PullRequestRecord;
  runId: string;
  className?: string;
  onMerged?: () => void;
}

export function PrCard({ pullRequest, runId, className, onMerged }: PrCardProps) {
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const [mergedNow, setMergedNow] = useState(false);

  const isMerged = pullRequest?.status === 'merged' || mergedNow;
  const canMerge = Boolean(
    pullRequest && pullRequest.url && pullRequest.number != null && !isMerged && pullRequest.status !== 'closed' && pullRequest.status !== 'failed',
  );

  async function handleMerge() {
    if (!pullRequest || merging) return;
    setMergeError(undefined);
    setMerging(true);

    try {
      const response = await fetch(`/api/runs/${runId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeMethod: 'squash' }),
      });
      const body = await response.json();

      if (!response.ok || (!body.merged && !body.alreadyMerged)) {
        throw new Error(body.error ?? body.message ?? `Merge failed (${response.status})`);
      }

      setMergedNow(true);
      onMerged?.();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
    } finally {
      setMerging(false);
    }
  }

  if (!pullRequest) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardHeader>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pull request</p>
          <CardTitle className="text-base">Waiting for verification</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            FlowPR opens a pull request after the fix is re-verified in the browser.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-primary/30',
        canMerge && 'ring-1 ring-primary/40 shadow-[0_0_18px_-6px_hsl(var(--primary)/0.45)]',
        isMerged && 'border-success/40 ring-1 ring-success/30',
        className,
      )}
    >
      {canMerge && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
      )}
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pull request</p>
          <StateBadge
            state={isMerged ? 'merged' : pullRequest.status}
            label={isMerged ? 'merged' : labelPullRequestStatus(pullRequest.status)}
          />
        </div>
        <CardTitle className="text-balance text-base leading-snug">
          {pullRequest.title || 'Untitled pull request'}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <GitPullRequest className="h-3 w-3" />
            {pullRequest.provider}
            {pullRequest.number != null && ` · #${pullRequest.number}`}
          </span>
          <span className="font-mono">
            {pullRequest.branchName} → {pullRequest.baseBranch}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pullRequest.url && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {isMerged ? (
              <Button asChild className="flex-1" variant="outline" disabled>
                <span>
                  <CheckCircle2 className="h-4 w-4" />
                  Merged
                </span>
              </Button>
            ) : (
              <Button
                onClick={handleMerge}
                disabled={!canMerge || merging}
                className="flex-1"
                variant="default"
              >
                {merging ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitMerge className="h-4 w-4" />
                )}
                {merging ? 'Merging…' : 'Merge PR'}
              </Button>
            )}
            <Button asChild className="flex-1" variant="outline">
              <a href={pullRequest.url} target="_blank" rel="noreferrer">
                View on {pullRequest.provider === 'github' ? 'GitHub' : pullRequest.provider}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
        )}
        {mergeError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {mergeError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
