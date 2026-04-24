import type { ProviderArtifact, RunDetail } from '@flowpr/schemas';

export type ReadinessState = 'ready' | 'partial' | 'missing';

export interface ArtifactRequirement {
  sponsor: ProviderArtifact['sponsor'];
  artifactType: string;
  description: string;
  optional?: boolean;
}

export interface ArtifactReadiness {
  sponsor: ProviderArtifact['sponsor'];
  artifactType: string;
  description: string;
  state: ReadinessState;
  found: number;
  latest?: {
    providerId?: string;
    url?: string;
    createdAt: string;
  };
}

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

export function computeArtifactReadiness(detail: RunDetail, requirements = REQUIRED_ARTIFACTS): ArtifactReadiness[] {
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

export function summarizeRunReadiness(detail: RunDetail): {
  overall: ReadinessState;
  readyCount: number;
  missingCount: number;
  partialCount: number;
  items: ArtifactReadiness[];
} {
  const items = computeArtifactReadiness(detail);
  const readyCount = items.filter((item) => item.state === 'ready').length;
  const missingCount = items.filter((item) => item.state === 'missing').length;
  const partialCount = items.filter((item) => item.state === 'partial').length;
  const overall: ReadinessState = missingCount > 0 ? 'missing' : partialCount > 0 ? 'partial' : 'ready';

  return { overall, readyCount, missingCount, partialCount, items };
}
