import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusToTone, toneToBadgeVariant } from '@/lib/state-tone';

interface StateBadgeProps {
  state?: string;
  label?: string;
  className?: string;
  dot?: boolean;
}

const userFacingLabels: Record<string, string> = {
  configured: 'Ready',
  missing: 'Setup needed',
  partial: 'Needs setup',
  local_artifact: 'Local mode',
  not_configured: 'Available after setup',
  live: 'Connected',
  ready: 'Ready',
  setup_needed: 'Setup needed',
};

export function StateBadge({ state, label, className, dot = true }: StateBadgeProps) {
  const tone = statusToTone(state);
  const text = label ?? (state ? userFacingLabels[state] : undefined) ?? state ?? '—';

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
