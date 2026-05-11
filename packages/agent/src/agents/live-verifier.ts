import { runAgentFlow, type TinyFishAgentFlowResult } from '@flowpr/tools/tinyfish';

export type LiveVerificationStatus = 'passed' | 'failed' | 'errored' | 'skipped';

export interface LiveVerificationInput {
  runId: string;
  previewUrl: string;
  flowGoal: string;
  maxAttempts?: number;
  skip?: boolean;
  skipReason?: string;
  label?: string;
}

export interface LiveVerificationResult {
  status: LiveVerificationStatus;
  attempts: number;
  summary: string;
  tinyfishRunId?: string;
  finalUrl?: string;
  screenshotUrl?: string;
  traceUrl?: string;
  lastError?: string;
  raw?: TinyFishAgentFlowResult | Record<string, unknown>;
}

export async function runLiveVerification(input: LiveVerificationInput): Promise<LiveVerificationResult> {
  if (input.skip) {
    return {
      status: 'skipped',
      attempts: 0,
      summary: input.skipReason ?? 'Live verification intentionally skipped.',
    };
  }

  const maxAttempts = Math.min(3, Math.max(1, input.maxAttempts ?? 2));
  let attemptCount = 0;
  let lastError: string | undefined;

  while (attemptCount < maxAttempts) {
    attemptCount += 1;

    try {
      const flow = await runAgentFlow({
        runId: input.runId,
        previewUrl: input.previewUrl,
        flowGoal: input.flowGoal,
        maxAttempts: 1,
      });

      if (flow.observation.passed) {
        return {
          status: 'passed',
          attempts: attemptCount,
          summary: 'TinyFish Agent re-verification confirmed the flow now passes.',
          tinyfishRunId: flow.providerRunId,
          finalUrl: flow.observation.finalUrl,
          screenshotUrl: flow.observation.screenshots[0],
          raw: flow,
        };
      }

      if (attemptCount >= maxAttempts) {
        return {
          status: 'failed',
          attempts: attemptCount,
          summary: flow.observation.visibleError
            ?? flow.observation.likelyRootCause
            ?? 'TinyFish Agent reports the flow still fails after the patch.',
          tinyfishRunId: flow.providerRunId,
          finalUrl: flow.observation.finalUrl,
          screenshotUrl: flow.observation.screenshots[0],
          raw: flow,
        };
      }

      lastError = flow.observation.visibleError ?? flow.observation.likelyRootCause;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (attemptCount >= maxAttempts) {
        return {
          status: 'errored',
          attempts: attemptCount,
          summary: `Live re-verification errored after ${attemptCount} attempt(s): ${lastError}`,
          lastError,
        };
      }
    }
  }

  return {
    status: 'errored',
    attempts: attemptCount,
    summary: lastError ?? 'Live verification did not produce a deterministic result.',
    lastError,
  };
}
