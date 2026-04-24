export type RunStatus =
  | 'queued'
  | 'loading_repo'
  | 'running_browser_qa'
  | 'triaging_failure'
  | 'retrieving_policy'
  | 'patching_code'
  | 'running_local_tests'
  | 'running_live_verification'
  | 'creating_pr'
  | 'done'
  | 'failed';

export interface FlowPrRun {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  baseBranch: string;
  workingBranch?: string;
  previewUrl: string;
  flowGoal: string;
  status: RunStatus;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  agentName: string;
  agentVersion: string;
  guildTraceId?: string;
  createdAt: string;
  updatedAt: string;
}

export function createDraftRun(input: {
  repoUrl: string;
  previewUrl: string;
  flowGoal: string;
  baseBranch?: string;
}): FlowPrRun {
  const now = new Date().toISOString();

  return {
    id: 'local-draft-run',
    repoUrl: input.repoUrl,
    owner: 'rishabhcli',
    repo: 'FlowPR',
    baseBranch: input.baseBranch ?? 'main',
    previewUrl: input.previewUrl,
    flowGoal: input.flowGoal,
    status: 'queued',
    riskLevel: 'medium',
    agentName: 'flowpr-autonomous-frontend-qa',
    agentVersion: '0.1.0',
    createdAt: now,
    updatedAt: now,
  };
}

