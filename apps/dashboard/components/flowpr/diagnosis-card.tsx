import { Check, ListChecks } from 'lucide-react';
import type { BugHypothesis } from '@flowpr/schemas';
import { labelConfidence, labelRiskLevel } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/flowpr/state-badge';
import { cn } from '@/lib/utils';

interface DiagnosisCardProps {
  hypothesis?: BugHypothesis;
  className?: string;
}

export function DiagnosisCard({ hypothesis, className }: DiagnosisCardProps) {
  if (!hypothesis) {
    return (
      <Card className={cn('border-dashed bg-card/40', className)}>
        <CardHeader>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diagnosis</p>
          <CardTitle className="text-base">Awaiting triage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            FlowPR will explain what broke and why once browser evidence lands.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diagnosis</p>
          <div className="flex gap-1.5">
            <StateBadge state={hypothesis.confidence} label={labelConfidence(hypothesis.confidence)} />
            <StateBadge state={hypothesis.severity} label={labelRiskLevel(hypothesis.severity)} />
          </div>
        </div>
        <CardTitle className="text-balance text-base leading-snug">{hypothesis.summary}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Affected flow: <span className="text-foreground">{hypothesis.affectedFlow}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {hypothesis.suspectedCause && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="mb-1 font-medium text-foreground">Suspected cause</p>
            <p className="text-muted-foreground">{hypothesis.suspectedCause}</p>
          </div>
        )}

        {hypothesis.acceptanceCriteria.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">Acceptance criteria</span>
            </div>
            <ul className="space-y-1.5">
              {hypothesis.acceptanceCriteria.map((criterion, index) => (
                <li key={index} className="flex gap-2 text-xs text-muted-foreground">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span className="leading-relaxed">
                    {criterion.text}
                    {criterion.source && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        · {criterion.source}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
