import {
  isBlockedPullRequestAttempt,
  validateRunEvidenceIntegrity,
  type EvidenceIntegrityIssue,
  type ProviderArtifact,
  type RunDetail,
} from '@flowpr/schemas';

export type ReadinessState = 'ready' | 'partial' | 'missing';
export type ReadinessSponsor = ProviderArtifact['sponsor'] | 'flowpr';

export interface ArtifactRequirement {
  sponsor: ProviderArtifact['sponsor'];
  artifactType: string;
  description: string;
  optional?: boolean;
}

export interface ArtifactReadiness {
  sponsor: ReadinessSponsor;
  artifactType: string;
  description: string;
  state: ReadinessState;
  found: number;
  issueCount?: number;
  dangerCount?: number;
  warningCount?: number;
  note?: string;
  latest?: {
    providerId?: string;
    url?: string;
    createdAt: string;
  };
}

export interface EvidenceIntegrityReadiness {
  state: ReadinessState;
  issueCount: number;
  dangerCount: number;
  warningCount: number;
  issues: EvidenceIntegrityIssue[];
}

type RunReadinessInput = Pick<
  RunDetail,
  'providerArtifacts' | 'browserObservations' | 'verificationResults' | 'pullRequests'
>;

export const REQUIRED_ARTIFACTS: ArtifactRequirement[] = [
  { sponsor: 'tinyfish', artifactType: 'browser_flow_test', description: 'Live TinyFish Agent QA run' },
  { sponsor: 'tinyfish', artifactType: 'live_reverification', description: 'Live re-verification after patch' },
  { sponsor: 'redis', artifactType: 'agent_step_emitted', description: 'Redis agent.step event' },
  { sponsor: 'redis', artifactType: 'patch_lock_verified', description: 'Redis patch mutation lock' },
  { sponsor: 'redis', artifactType: 'pr_lock_verified', description: 'Redis PR mutation lock' },
  { sponsor: 'insforge', artifactType: 'triage_diagnosis', description: 'FlowPR diagnosis record' },
  { sponsor: 'wundergraph', artifactType: 'safe_operation_execution', description: 'WunderGraph safe operation execution' },
  { sponsor: 'guildai', artifactType: 'agent_session_started', description: 'Guild.ai session trace' },
  { sponsor: 'guildai', artifactType: 'action_gate_create_pull_request', description: 'Guild.ai PR action gate' },
  { sponsor: 'senso', artifactType: 'policy_context', description: 'Senso policy grounding' },
  { sponsor: 'github', artifactType: 'pull_request', description: 'GitHub pull request', optional: true },
  { sponsor: 'playwright', artifactType: 'local_verification', description: 'Playwright local verification', optional: true },
];

export function computeArtifactReadiness(detail: Pick<RunDetail, 'providerArtifacts'>, requirements = REQUIRED_ARTIFACTS): ArtifactReadiness[] {
  return requirements.map((requirement) => {
    const matches = detail.providerArtifacts.filter(
      (artifact) => artifact.sponsor === requirement.sponsor && artifact.artifactType === requirement.artifactType,
    );
    const latest = matches[matches.length - 1];
    const state: ReadinessState = matches.length > 0 ? 'ready' : requirement.optional ? 'partial' : 'missing';

    return {
      sponsor: requirement.sponsor,
      artifactType: requirement.artifactType,
      description: requirement.description,
      state,
      found: matches.length,
      latest: latest
        ? {
            providerId: latest.providerId,
            url: latest.artifactUrl,
            createdAt: latest.createdAt,
          }
        : undefined,
    };
  });
}

function hasProviderArtifact(
  detail: Pick<RunDetail, 'providerArtifacts'>,
  sponsor: ProviderArtifact['sponsor'],
  artifactType: string,
): boolean {
  return detail.providerArtifacts.some(
    (artifact) => artifact.sponsor === sponsor && artifact.artifactType === artifactType,
  );
}

function hasGuildHeldPullRequestHandoff(detail: RunReadinessInput): boolean {
  const guildGateRecorded = hasProviderArtifact(detail, 'guildai', 'action_gate_create_pull_request');
  const handoffRecorded = hasProviderArtifact(detail, 'insforge', 'investigation_report');
  const blockedBeforeMutation = detail.pullRequests.some((pullRequest) => {
    const raw = (pullRequest.raw ?? {}) as Record<string, unknown>;
    const gate = (raw.gate ?? {}) as Record<string, unknown>;
    return isBlockedPullRequestAttempt(pullRequest) &&
      (raw.attemptType === 'gate_denied' || gate.decision === 'denied');
  });

  return guildGateRecorded && handoffRecorded && blockedBeforeMutation;
}

function applyContextualReadiness(detail: RunReadinessInput, item: ArtifactReadiness): ArtifactReadiness {
  if (!hasGuildHeldPullRequestHandoff(detail)) {
    return item;
  }

  if (item.sponsor === 'redis' && item.artifactType === 'pr_lock_verified' && item.state === 'missing') {
    return {
      ...item,
      state: 'ready',
      description: 'Redis PR mutation lock was not required because Guild.ai held the PR before GitHub mutation',
      note: 'Gate-held handoff path.',
    };
  }

  if (item.sponsor === 'github' && item.artifactType === 'pull_request' && item.state !== 'ready') {
    return {
      ...item,
      state: 'ready',
      description: 'GitHub PR was intentionally replaced by a human handoff report after the Guild.ai gate held creation',
      note: 'No PR expected for this gate outcome.',
    };
  }

  return item;
}

export function computeEvidenceIntegrityReadiness(detail: RunReadinessInput): EvidenceIntegrityReadiness {
  const issues = validateRunEvidenceIntegrity(detail);
  const dangerCount = issues.filter((issue) => issue.severity === 'danger').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const state: ReadinessState = dangerCount > 0 ? 'missing' : warningCount > 0 ? 'partial' : 'ready';

  return {
    state,
    issueCount: issues.length,
    dangerCount,
    warningCount,
    issues,
  };
}

function evidenceIntegrityItem(readiness: EvidenceIntegrityReadiness): ArtifactReadiness {
  const description = readiness.issueCount === 0
    ? 'Browser observations, verification rows, and PR records are backed by durable provider artifacts'
    : `${readiness.dangerCount} critical and ${readiness.warningCount} warning provider-proof issue${readiness.issueCount === 1 ? '' : 's'}`;

  return {
    sponsor: 'flowpr',
    artifactType: 'evidence_integrity',
    description,
    state: readiness.state,
    found: readiness.issueCount === 0 ? 1 : 0,
    issueCount: readiness.issueCount,
    dangerCount: readiness.dangerCount,
    warningCount: readiness.warningCount,
  };
}

export function summarizeRunReadiness(detail: RunReadinessInput): {
  overall: ReadinessState;
  readyCount: number;
  missingCount: number;
  partialCount: number;
  items: ArtifactReadiness[];
  evidenceIntegrity: EvidenceIntegrityReadiness;
} {
  const evidenceIntegrity = computeEvidenceIntegrityReadiness(detail);
  const items = [
    evidenceIntegrityItem(evidenceIntegrity),
    ...computeArtifactReadiness(detail).map((item) => applyContextualReadiness(detail, item)),
  ];
  const readyCount = items.filter((item) => item.state === 'ready').length;
  const missingCount = items.filter((item) => item.state === 'missing').length;
  const partialCount = items.filter((item) => item.state === 'partial').length;
  const overall: ReadinessState = missingCount > 0 ? 'missing' : partialCount > 0 ? 'partial' : 'ready';

  return { overall, readyCount, missingCount, partialCount, items, evidenceIntegrity };
}
