import { cn } from '@/lib/utils';
import { StateBadge } from '@/components/flowpr/state-badge';
import { formatRelativeTime } from '@/lib/format';
import { statusToTone, toneDotClass } from '@/lib/state-tone';

export interface SponsorStatus {
  sponsor: string;
  state: 'live' | 'not_configured' | 'failed' | 'local_artifact';
  summary: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

interface SponsorRailProps {
  statuses: SponsorStatus[];
  variant?: 'compact' | 'full';
  className?: string;
}

const ORDER = [
  'tinyfish',
  'redis',
  'insforge',
  'guildai',
  'senso',
  'shipables',
  'wundergraph',
  'github',
  'akash',
  'chainguard',
  'playwright',
];

function order(a: SponsorStatus, b: SponsorStatus) {
  const ai = ORDER.indexOf(a.sponsor);
  const bi = ORDER.indexOf(b.sponsor);
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
}

function sponsorName(sponsor: string) {
  if (sponsor === 'tinyfish') return 'TinyFish';
  if (sponsor === 'guildai') return 'Guild.ai';
  if (sponsor === 'wundergraph') return 'WunderGraph';
  if (sponsor === 'insforge') return 'InsForge';
  if (sponsor === 'senso') return 'Senso';
  if (sponsor === 'shipables') return 'Shipables';
  if (sponsor === 'chainguard') return 'Chainguard';
  return sponsor.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SponsorRail({ statuses, variant = 'full', className }: SponsorRailProps) {
  const sorted = [...statuses].sort(order);

  if (variant === 'compact') {
    return (
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        {sorted.map((status) => {
          const tone = statusToTone(status.state);
          return (
            <span
              key={status.sponsor}
              title={`${sponsorName(status.sponsor)} · ${status.state.replace('_', ' ')}\n${status.summary}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClass(tone))} />
              {sponsorName(status.sponsor)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-2 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {sorted.map((status) => (
        <div
          key={status.sponsor}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {sponsorName(status.sponsor)}
            </p>
            <StateBadge state={status.state} />
          </div>
          <p
            className="line-clamp-2 text-xs text-muted-foreground"
            title={status.summary}
          >
            {status.summary}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {formatRelativeTime(status.checkedAt)}
          </p>
        </div>
      ))}
    </div>
  );
}
