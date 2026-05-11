import { ArrowUpRight, FileText, ShieldAlert } from 'lucide-react';
import type { ProviderArtifact, RunDetail } from '@flowpr/schemas';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { artifactSrc } from '@/lib/artifact-url';

interface HandoffReportCardProps {
  detail: RunDetail;
}

function latestInvestigationReport(artifacts: ProviderArtifact[]): ProviderArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.artifactType === 'investigation_report');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstMarkdownLine(markdown: string | undefined): string | undefined {
  if (!markdown) return undefined;
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line && !line.startsWith('_'));
}

export function HandoffReportCard({ detail }: HandoffReportCardProps) {
  const artifact = latestInvestigationReport(detail.providerArtifacts);
  if (!artifact) return null;

  const requestSummary = asRecord(artifact.requestSummary);
  const responseSummary = asRecord(artifact.responseSummary);
  const raw = asRecord(artifact.raw);
  const structured = asRecord(responseSummary.structured);
  const markdown = asString(raw.markdown);
  const reportHref = artifactSrc(detail.run.id, {
    key: artifact.storageKey,
    url: artifact.artifactUrl,
  });
  const reason = asString(requestSummary.reason);
  const openedPrCount = Number(structured.openedPullRequestCount ?? 0);
  const blockedAttemptCount = Number(structured.blockedPullRequestAttemptCount ?? 0);
  const isGateHeldHandoff = blockedAttemptCount > 0 && openedPrCount === 0;
  const summary = isGateHeldHandoff
    ? 'Verified patch ready; pull request held by action gate.'
    : asString(responseSummary.summary) ?? firstMarkdownLine(markdown) ?? 'Investigation report ready for human review.';

  return (
    <Card className="border-warning/35 bg-warning/5">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Human handoff</p>
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning">
            <ShieldAlert className="h-3 w-3" />
            Report ready
          </span>
        </div>
        <CardTitle className="text-balance text-base leading-snug">{summary}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reason && (
          <p className="text-sm text-muted-foreground">{reason}</p>
        )}
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded border border-border bg-card/50 px-2 py-1">
            Opened PRs: {Number.isFinite(openedPrCount) ? openedPrCount : 0}
          </span>
          <span className="rounded border border-border bg-card/50 px-2 py-1">
            Blocked attempts: {Number.isFinite(blockedAttemptCount) ? blockedAttemptCount : 0}
          </span>
        </div>
        {reportHref ? (
          <Button asChild variant="outline" className="w-full">
            <a href={reportHref} target="_blank" rel="noreferrer">
              <FileText className="h-4 w-4" />
              Open handoff report
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <p className="rounded-md border border-border bg-card/40 p-3 text-xs text-muted-foreground">
            The report is stored inline with the provider artifact for this run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
