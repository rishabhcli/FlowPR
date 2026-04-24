export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

const SUCCESS = new Set([
  'ready',
  'live',
  'passed',
  'done',
  'configured',
  'open',
  'allowed',
  'approved',
  'completed',
  'merged',
  'verified',
  'tested',
  'applied',
  'generated',
  'learned',
  'ready',
]);

const WARNING = new Set([
  'partial',
  'pending',
  'local_artifact',
  'running',
  'draft',
  'queued',
  'started',
  'planned',
  'info',
  'created',
  'loading_repo',
  'discovering_flows',
  'running_browser_qa',
  'collecting_visual_evidence',
  'triaging_failure',
  'retrieving_policy',
  'searching_memory',
  'patching_code',
  'running_local_tests',
  'running_live_verification',
  'creating_pr',
  'publishing_artifacts',
  'setup_needed',
]);

const DANGER = new Set([
  'missing',
  'not_configured',
  'failed',
  'errored',
  'blocked',
  'rejected',
  'closed',
  'abandoned',
  'critical',
  'high',
]);

const INFO = new Set(['skipped', 'low', 'medium']);

export function statusToTone(status?: string): Tone {
  if (!status) return 'muted';
  const key = status.toLowerCase();
  if (SUCCESS.has(key)) return 'success';
  if (WARNING.has(key)) return 'warning';
  if (DANGER.has(key)) return 'danger';
  if (INFO.has(key)) return 'info';
  return 'muted';
}

export function toneToBadgeVariant(
  tone: Tone,
): 'default' | 'success' | 'warning' | 'destructive' | 'muted' | 'secondary' {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'danger':
      return 'destructive';
    case 'info':
      return 'secondary';
    case 'muted':
      return 'muted';
  }
}

export function toneTextClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'danger':
      return 'text-destructive';
    case 'info':
      return 'text-primary';
    case 'muted':
      return 'text-muted-foreground';
  }
}

export function toneDotClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'bg-success';
    case 'warning':
      return 'bg-warning';
    case 'danger':
      return 'bg-destructive';
    case 'info':
      return 'bg-primary';
    case 'muted':
      return 'bg-muted-foreground/50';
  }
}
