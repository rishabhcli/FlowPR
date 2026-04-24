import type {
  ActionGateStatus,
  AgentSessionStatus,
  BenchmarkEvaluationStatus,
  BrowserObservationStatus,
  HypothesisConfidence,
  PatchStatus,
  PermissionProfile,
  PullRequestStatus,
  RiskLevel,
  RunStatus,
  TimelineEventStatus,
  VerificationStatus,
} from './run';

export const runStatusLabels: Record<RunStatus, string> = {
  queued: 'Waiting',
  loading_repo: 'Reading repository',
  discovering_flows: 'Reading flow',
  running_browser_qa: 'Testing',
  collecting_visual_evidence: 'Collecting evidence',
  triaging_failure: 'Explaining failure',
  retrieving_policy: 'Checking rulebook',
  searching_memory: 'Checking memory',
  patching_code: 'Preparing fix',
  running_local_tests: 'Verifying locally',
  running_live_verification: 'Verifying',
  creating_pr: 'Opening pull request',
  publishing_artifacts: 'Saving evidence',
  learned: 'Remembering',
  done: 'PR ready',
  failed: 'Needs review',
};

export const runStatusDescriptions: Record<RunStatus, string> = {
  queued: 'The run is waiting to start.',
  loading_repo: 'FlowPR is reading the repository.',
  discovering_flows: 'FlowPR is reading the user journey it was asked to protect.',
  running_browser_qa: 'FlowPR is opening the app in a real browser and trying the journey.',
  collecting_visual_evidence: 'FlowPR is collecting screenshots and page state.',
  triaging_failure: 'FlowPR is explaining what the user saw and why the journey failed.',
  retrieving_policy: 'FlowPR is checking the team’s product rules.',
  searching_memory: 'FlowPR is checking whether it has seen a similar failure before.',
  patching_code: 'FlowPR is preparing a focused code change.',
  running_local_tests: 'FlowPR is running local checks on the patched code.',
  running_live_verification: 'FlowPR is rerunning the journey in a real browser to prove the fix.',
  creating_pr: 'FlowPR is opening a pull request on GitHub with the evidence packet.',
  publishing_artifacts: 'FlowPR is saving the run evidence.',
  learned: 'FlowPR is remembering this pattern for future runs.',
  done: 'The pull request is ready for review.',
  failed: 'FlowPR could not finish safely. The run is ready for a human to review.',
};

export const browserObservationStatusLabels: Record<BrowserObservationStatus, string> = {
  queued: 'Pending',
  passed: 'Journey passed',
  failed: 'Journey failed',
  errored: 'Tool error',
};

export const patchStatusLabels: Record<PatchStatus, string> = {
  planned: 'Planned',
  generated: 'Patch ready',
  applied: 'Patch applied',
  tested: 'Patch tested',
  failed: 'Patch failed',
  abandoned: 'Patch abandoned',
};

export const verificationStatusLabels: Record<VerificationStatus, string> = {
  queued: 'Pending',
  passed: 'Verified',
  failed: 'Did not pass',
  errored: 'Tool error',
  skipped: 'Not run',
};

export const pullRequestStatusLabels: Record<PullRequestStatus, string> = {
  draft: 'Draft',
  open: 'Open for review',
  merged: 'Merged',
  closed: 'Closed',
  failed: 'Blocked',
};

export const confidenceLabels: Record<HypothesisConfidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export const riskLevelLabels: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical',
};

export const permissionProfileLabels: Record<PermissionProfile, string> = {
  'investigation-only': 'Investigation only — never change code',
  'draft-pr-only': 'Draft PRs only — safest default',
  'verified-pr': 'Verified PRs — open PRs when the fix passes',
};

export const permissionProfileDescriptions: Record<PermissionProfile, string> = {
  'investigation-only': 'FlowPR runs the browser test, captures evidence, and writes an investigation report. No code changes.',
  'draft-pr-only': 'FlowPR may prepare a patch and open a GitHub pull request as a draft for human review.',
  'verified-pr': 'FlowPR may open a non-draft pull request when local and live verification pass.',
};

export const agentSessionStatusLabels: Record<AgentSessionStatus, string> = {
  created: 'Opened',
  running: 'Active',
  completed: 'Completed',
  failed: 'Ended with failure',
};

export const actionGateStatusLabels: Record<ActionGateStatus, string> = {
  pending: 'Waiting for approval',
  allowed: 'Approved',
  blocked: 'Blocked',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const benchmarkEvaluationStatusLabels: Record<BenchmarkEvaluationStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  errored: 'Tool error',
  skipped: 'Skipped',
};

export const timelineEventStatusLabels: Record<TimelineEventStatus, string> = {
  started: 'Started',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  info: 'Note',
};

export function labelRunStatus(status: RunStatus): string {
  return runStatusLabels[status] ?? status;
}

export function describeRunStatus(status: RunStatus): string {
  return runStatusDescriptions[status] ?? 'Run update.';
}

export function labelBrowserObservationStatus(status: BrowserObservationStatus): string {
  return browserObservationStatusLabels[status] ?? status;
}

export function labelPatchStatus(status: PatchStatus): string {
  return patchStatusLabels[status] ?? status;
}

export function labelVerificationStatus(status: VerificationStatus): string {
  return verificationStatusLabels[status] ?? status;
}

export function labelPullRequestStatus(status: PullRequestStatus): string {
  return pullRequestStatusLabels[status] ?? status;
}

export function labelConfidence(confidence: HypothesisConfidence): string {
  return confidenceLabels[confidence] ?? confidence;
}

export function labelRiskLevel(risk: RiskLevel): string {
  return riskLevelLabels[risk] ?? risk;
}

export function labelPermissionProfile(profile: PermissionProfile): string {
  return permissionProfileLabels[profile] ?? profile;
}

export function describePermissionProfile(profile: PermissionProfile): string {
  return permissionProfileDescriptions[profile] ?? '';
}

export function labelAgentSessionStatus(status: AgentSessionStatus): string {
  return agentSessionStatusLabels[status] ?? status;
}

export function labelActionGateStatus(status: ActionGateStatus): string {
  return actionGateStatusLabels[status] ?? status;
}

export function labelBenchmarkEvaluationStatus(status: BenchmarkEvaluationStatus): string {
  return benchmarkEvaluationStatusLabels[status] ?? status;
}
