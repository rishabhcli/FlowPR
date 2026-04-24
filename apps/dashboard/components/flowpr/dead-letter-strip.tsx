'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface DeadLetterEntry {
  id: string;
  runId: string;
  sourceStream?: string;
  eventType?: string;
  phase?: string;
  attempt?: number;
  error?: string;
  createdAt?: string;
}

interface DeadLetterStripProps {
  className?: string;
}

export function DeadLetterStrip({ className }: DeadLetterStripProps) {
  const [entries, setEntries] = useState<DeadLetterEntry[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/dead-letter?count=5', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { entries: DeadLetterEntry[] };
        setEntries(body.entries ?? []);
      } catch {
        // silent
      }
    }
    load();
    const interval = window.setInterval(load, 30000);
    return () => window.clearInterval(interval);
  }, []);

  if (entries.length === 0) return null;

  const newest = entries[0];

  return (
    <Alert variant="destructive" className={cn('flex items-start gap-3', className)}>
      <AlertTriangle className="h-4 w-4" />
      <div className="min-w-0 flex-1">
        <AlertTitle>
          {entries.length} dead-lettered {entries.length === 1 ? 'event' : 'events'} awaiting review
        </AlertTitle>
        <AlertDescription>
          <p className="text-xs">
            Most recent: <span className="font-mono">{newest.phase ?? newest.eventType ?? 'unknown phase'}</span>
            {newest.runId && (
              <>
                {' on run '}
                <Link
                  className="font-mono text-foreground underline-offset-4 hover:underline"
                  href={`/runs/${newest.runId}`}
                >
                  {newest.runId.slice(0, 8)}
                </Link>
              </>
            )}
            {newest.error && (
              <span className="block truncate text-muted-foreground">
                {newest.error}
              </span>
            )}
          </p>
        </AlertDescription>
      </div>
      <Link
        href="/health"
        className="inline-flex items-center gap-1 self-center text-xs text-destructive hover:underline"
      >
        review <ArrowRight className="h-3 w-3" />
      </Link>
    </Alert>
  );
}
