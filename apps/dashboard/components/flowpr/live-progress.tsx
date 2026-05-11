'use client';

import { Activity, Radio } from 'lucide-react';
import { normalizeRunOutcomeCopy } from '@flowpr/schemas';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import type { RunProgressEntry } from '@/lib/use-run-stream';

interface LiveProgressProps {
  progress: RunProgressEntry[];
  connected: boolean;
  className?: string;
}

export function LiveProgress({ progress, connected, className }: LiveProgressProps) {
  const entries = [...progress].reverse().slice(0, 40);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Live progress
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Real-time stream of phase transitions and sub-steps.
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
            connected
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-muted/40 bg-muted/20 text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connected ? 'animate-pulse bg-success' : 'bg-muted-foreground/50',
            )}
          />
          {connected ? 'live' : 'idle'}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[220px] px-4 pb-4">
          {entries.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">
              <Radio className="mr-2 h-3.5 w-3.5" /> Waiting for the next event…
            </div>
          ) : (
            <ul className="space-y-1.5 pt-2">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2"
                >
                  <Activity className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">
                      {normalizeRunOutcomeCopy(entry.message || entry.kind)}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {entry.actor && <span>{entry.actor}</span>}
                      {entry.phase && <span>· {entry.phase.replace(/_/g, ' ')}</span>}
                      {entry.createdAt && (
                        <span className="ml-auto font-mono text-muted-foreground/70">
                          {formatTime(entry.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
