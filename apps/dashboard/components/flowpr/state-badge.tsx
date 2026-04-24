import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusToTone, toneToBadgeVariant } from '@/lib/state-tone';

interface StateBadgeProps {
  state?: string;
  label?: string;
  className?: string;
  dot?: boolean;
}

export function StateBadge({ state, label, className, dot = true }: StateBadgeProps) {
  const tone = statusToTone(state);
  const text = (label ?? state ?? '—').replace(/_/g, ' ');

  return (
    <Badge
      variant={toneToBadgeVariant(tone)}
      className={cn('gap-1.5 capitalize', className)}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', {
            'bg-success': tone === 'success',
            'bg-warning animate-pulse': tone === 'warning',
            'bg-destructive': tone === 'danger',
            'bg-primary': tone === 'info',
            'bg-muted-foreground/60': tone === 'muted',
          })}
        />
      )}
      {text}
    </Badge>
  );
}
