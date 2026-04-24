import { FileCode, GitCommit, Minus, Plus } from 'lucide-react';
import type { PatchRecord } from '@flowpr/schemas';
import { labelPatchStatus } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';

interface PatchCardProps {
  patch?: PatchRecord;
  className?: string;
}

export function PatchCard({ patch, className }: PatchCardProps) {
  if (!patch) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardHeader>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Patch</p>
          <CardTitle className="text-base">Not generated yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            The patch lands after diagnosis completes and a fix is drafted.
          </p>
        </CardContent>
      </Card>
    );
  }

  const diffStat = patch.diffStat as { added?: number; removed?: number; files?: number } | undefined;
  const added = diffStat?.added ?? 0;
  const removed = diffStat?.removed ?? 0;
  const fileCount = patch.filesChanged.length || diffStat?.files || 0;

  return (
    <Card className={className}>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Patch</p>
          <StateBadge state={patch.status} label={labelPatchStatus(patch.status)} />
        </div>
        <CardTitle className="text-balance text-base leading-snug">{patch.summary}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded border border-border bg-card/60 px-2 py-1">
            <FileCode className="h-3 w-3" /> {fileCount} {fileCount === 1 ? 'file' : 'files'}
          </span>
          {added > 0 && (
            <span className="inline-flex items-center gap-1 text-success">
              <Plus className="h-3 w-3" /> {added}
            </span>
          )}
          {removed > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <Minus className="h-3 w-3" /> {removed}
            </span>
          )}
          {patch.branchName && (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {patch.branchName}
            </span>
          )}
        </div>

        {patch.filesChanged.length > 0 && (
          <ul className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
            {patch.filesChanged.slice(0, 6).map((file, index) => {
              const f = file as { path?: string; name?: string; changeType?: string };
              const path = f.path ?? f.name ?? `file-${index + 1}`;
              return (
                <li
                  key={`${path}-${index}`}
                  className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground"
                >
                  <span className="truncate">{path}</span>
                  {f.changeType && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {f.changeType}
                    </span>
                  )}
                </li>
              );
            })}
            {patch.filesChanged.length > 6 && (
              <li className="pt-1 text-[11px] text-muted-foreground/70">
                +{patch.filesChanged.length - 6} more
              </li>
            )}
          </ul>
        )}

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {patch.commitSha && (
              <>
                <GitCommit className="h-3 w-3" />
                <span className="font-mono">{patch.commitSha.slice(0, 7)}</span>
              </>
            )}
          </span>
          <span>{formatTime(patch.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
