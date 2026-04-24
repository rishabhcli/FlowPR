import { ArrowUpRight, GitPullRequest } from 'lucide-react';
import type { PullRequestRecord } from '@flowpr/schemas';
import { labelPullRequestStatus } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';

interface PrCardProps {
  pullRequest?: PullRequestRecord;
  className?: string;
}

export function PrCard({ pullRequest, className }: PrCardProps) {
  if (!pullRequest) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardHeader>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pull request</p>
          <CardTitle className="text-base">Waiting for verification</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            FlowPR opens a draft PR after the fix is re-verified in the browser.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-primary/30', className)}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pull request</p>
          <StateBadge state={pullRequest.status} label={labelPullRequestStatus(pullRequest.status)} />
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
      <CardContent>
        {pullRequest.url && (
          <Button asChild className="w-full" variant="default">
            <a href={pullRequest.url} target="_blank" rel="noreferrer">
              View on {pullRequest.provider === 'github' ? 'GitHub' : pullRequest.provider}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
