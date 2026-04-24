import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Tone } from '@/lib/state-tone';
import { toneTextClass } from '@/lib/state-tone';

interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricTile({
  label,
  value,
  caption,
  tone,
  icon,
  className,
}: MetricTileProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              'mt-2 font-display text-3xl font-semibold leading-none tabular-nums',
              tone ? toneTextClass(tone) : 'text-foreground',
            )}
          >
            {value}
          </p>
          {caption && (
            <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
          )}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardContent>
    </Card>
  );
}
