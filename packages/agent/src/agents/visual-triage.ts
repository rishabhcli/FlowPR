import type {
  BrowserObservation,
  HypothesisConfidence,
  PolicyHit,
  RiskLevel,
} from '@flowpr/schemas';

export type BugType =
  | 'blocked_cta'
  | 'broken_link'
  | 'missing_submit'
  | 'client_navigation_failure'
  | 'hydration_error'
  | 'network_error'
  | 'form_validation_loop'
  | 'responsive_layout_regression'
  | 'auth_redirect_failure'
  | 'unknown';

export interface TriageEvidence {
  provider: 'tinyfish' | 'playwright' | 'mixed';
  providerRunId?: string;
  failedStep?: string;
  visibleError?: string;
  finalUrl?: string;
  topDomFinding?: string;
  screenshotUrl?: string;
  traceUrl?: string;
  consoleErrors: string[];
  networkErrors: string[];
}

export interface BugSignatureParts {
  bugType: BugType;
  failedStep: string;
  topDomFinding: string;
  flowGoalKey: string;
}

export interface PolicyContext {
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  severityGuidance: Array<{ text: string; source?: string }>;
  prRequirements: string[];
  codingConstraints: string[];
  citations: Array<{ title: string; url?: string; excerpt?: string }>;
}

export interface MemoryContext {
  signatureHash: string;
  priorBugMemory: Record<string, string>;
  priorPatchMemory: Record<string, string>;
}

export interface TriageInput {
  flowGoal: string;
  baselineRisk: RiskLevel;
  observations: BrowserObservation[];
  policy: PolicyContext;
  memory: MemoryContext;
}

export interface TriageOutput {
  bugType: BugType;
  severity: RiskLevel;
  confidence: HypothesisConfidence;
  confidenceScore: number;
  hypothesis: string;
  summary: string;
  likelyFiles: string[];
  suspectedCause: string;
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  evidence: TriageEvidence;
  signature: BugSignatureParts;
  reusedMemory: boolean;
}

const FLOW_CRITICAL_KEYWORDS = ['checkout', 'payment', 'pay', 'billing', 'signup', 'sign up', 'login', 'auth', 'export'];
const FLOW_HIGH_KEYWORDS = ['pricing', 'dashboard', 'onboarding', 'upgrade'];

function toLower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function flattenFinding(observation: BrowserObservation | undefined): string | undefined {
  if (!observation) return undefined;
  const dom = (observation.domSummary ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

  return dom[0];
}

function flattenErrors(values: Record<string, unknown>[] | undefined): string[] {
  if (!values) return [];

  return values
    .map((value) => {
      if (typeof value === 'string') return value;

      if (value && typeof value === 'object') {
        if (typeof (value as Record<string, unknown>).message === 'string') {
          return String((value as Record<string, unknown>).message);
        }

        if (typeof (value as Record<string, unknown>).url === 'string') {
          return String((value as Record<string, unknown>).url);
        }
      }

      return String(value ?? '');
    })
    .filter((line) => line.length > 0);
}

function pickPrimaryObservation(observations: BrowserObservation[]): BrowserObservation | undefined {
  const failures = observations.filter((observation) => observation.status === 'failed' || observation.status === 'errored');

  if (failures.length === 0) return observations[observations.length - 1];

  failures.sort((a, b) => {
    const score = (o: BrowserObservation) => (o.provider === 'tinyfish' ? 2 : 1) + (o.status === 'failed' ? 1 : 0);
    return score(b) - score(a);
  });

  return failures[0];
}

function classifyBugType(input: {
  flowGoal: string;
  failedStep: string;
  visibleError: string;
  domFinding: string;
  consoleErrors: string[];
  networkErrors: string[];
}): BugType {
  const { flowGoal, failedStep, visibleError, domFinding, consoleErrors, networkErrors } = input;
  const haystack = [flowGoal, failedStep, visibleError, domFinding, ...consoleErrors, ...networkErrors]
    .map(toLower)
    .join(' | ');

  if (/(cookie|banner|overlay|covered|obstruct|not clickable|intercepted|banner covers)/.test(haystack)) {
    return 'blocked_cta';
  }

  if (/(hydration|react.*hydration|mismatch|suspense)/.test(haystack)) {
    return 'hydration_error';
  }

  if (/(auth|login|token|unauthori[sz]ed|redirect.*login)/.test(haystack)) {
    return 'auth_redirect_failure';
  }

  if (/(404|500|network|cors|fetch failed|request failed)/.test(haystack) && networkErrors.length > 0) {
    return 'network_error';
  }

  if (/(form|validation|submit.*fail|invalid|required field)/.test(haystack)) {
    return 'form_validation_loop';
  }

  if (/(router|navigation|next\/link|usepathname|usenavigate|route)/.test(haystack)) {
    return 'client_navigation_failure';
  }

  if (/(viewport|mobile|390|320|414|layout|responsive|overflow)/.test(haystack)) {
    return 'responsive_layout_regression';
  }

  if (/(submit|button missing|no button|cta not found)/.test(haystack)) {
    return 'missing_submit';
  }

  if (/(href|link|anchor.*broken|dead link|broken link)/.test(haystack)) {
    return 'broken_link';
  }

  return 'unknown';
}

function inferSeverity(flowGoal: string, baseline: RiskLevel, bugType: BugType): RiskLevel {
  const goal = toLower(flowGoal);
  const ranking: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const indexOf = (value: RiskLevel) => ranking.indexOf(value);
  let severity: RiskLevel = baseline;

  if (FLOW_CRITICAL_KEYWORDS.some((keyword) => goal.includes(keyword))) {
    severity = 'critical';
  } else if (FLOW_HIGH_KEYWORDS.some((keyword) => goal.includes(keyword))) {
    severity = indexOf(severity) < indexOf('high') ? 'high' : severity;
  }

  if (bugType === 'blocked_cta' && goal.includes('checkout')) {
    severity = 'critical';
  }

  if (bugType === 'auth_redirect_failure') {
    severity = indexOf(severity) < indexOf('high') ? 'high' : severity;
  }

  return severity;
}

function inferLikelyFiles(input: { bugType: BugType; flowGoal: string; domFinding: string }): string[] {
  const goal = toLower(input.flowGoal);
  const files: string[] = [];

  if (input.bugType === 'blocked_cta') {
    if (input.domFinding.toLowerCase().includes('cookie')) {
      files.push('apps/demo-target/app/checkout/page.tsx', 'apps/demo-target/app/styles.css');
    } else {
      files.push('apps/demo-target/app/styles.css');
    }
  }

  if (input.bugType === 'client_navigation_failure') {
    files.push('apps/demo-target/app/checkout/page.tsx');
  }

  if (input.bugType === 'auth_redirect_failure') {
    files.push('apps/demo-target/app/layout.tsx');
  }

  if (input.bugType === 'responsive_layout_regression' && goal.includes('mobile')) {
    files.push('apps/demo-target/app/styles.css');
  }

  if (files.length === 0) {
    files.push('apps/demo-target/app/page.tsx');
  }

  return Array.from(new Set(files));
}

function toConfidenceScore(input: {
  observationCount: number;
  matchingFailureCount: number;
  reusedMemory: boolean;
  policyMatched: boolean;
}): number {
  let score = 0.35;

  if (input.matchingFailureCount >= 2) {
    score += 0.25;
  } else if (input.matchingFailureCount === 1) {
    score += 0.15;
  }

  if (input.reusedMemory) {
    score += 0.2;
  }

  if (input.policyMatched) {
    score += 0.15;
  }

  if (input.observationCount >= 3) {
    score += 0.05;
  }

  return Math.min(0.99, Math.round(score * 100) / 100);
}

function toConfidenceLabel(score: number): HypothesisConfidence {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function flowGoalKey(flowGoal: string): string {
  const normalized = toLower(flowGoal).replace(/[^a-z0-9]+/g, ' ').trim();
  const keywords = normalized.split(/\s+/).filter((word) => word.length >= 3).slice(0, 4);
  return keywords.join('-') || 'generic-flow';
}

export function buildBugSignatureParts(input: {
  bugType: BugType;
  failedStep?: string;
  topDomFinding?: string;
  flowGoal: string;
}): BugSignatureParts {
  return {
    bugType: input.bugType,
    failedStep: (input.failedStep ?? 'unknown-step').toLowerCase().replace(/\s+/g, '_'),
    topDomFinding: (input.topDomFinding ?? 'no-dom').toLowerCase().replace(/\s+/g, '_').slice(0, 48),
    flowGoalKey: flowGoalKey(input.flowGoal),
  };
}

export function policyContextFromHits(hits: PolicyHit[]): PolicyContext {
  const acceptanceCriteria: Array<{ text: string; source?: string }> = [];
  const severityGuidance: Array<{ text: string; source?: string }> = [];
  const prRequirements: string[] = [];
  const codingConstraints: string[] = [];
  const citations: Array<{ title: string; url?: string; excerpt?: string }> = [];

  for (const hit of hits) {
    const title = hit.title ?? 'policy entry';
    const url = hit.sourceUrl;
    const summary = hit.summary ?? '';
    const raw = (hit.raw ?? {}) as Record<string, unknown>;
    const policyKind = typeof raw.kind === 'string' ? raw.kind : undefined;

    citations.push({ title, url, excerpt: summary });

    if (policyKind === 'severity' || /severity|critical/i.test(summary)) {
      severityGuidance.push({ text: summary || title, source: title });
    }

    if (policyKind === 'pr' || /pull request|pr evidence|evidence/i.test(summary)) {
      prRequirements.push(summary || title);
    }

    if (policyKind === 'code' || /code style|diff|minimal/i.test(summary)) {
      codingConstraints.push(summary || title);
    }

    acceptanceCriteria.push({ text: summary || title, source: title });
  }

  return {
    acceptanceCriteria,
    severityGuidance,
    prRequirements: Array.from(new Set(prRequirements)),
    codingConstraints: Array.from(new Set(codingConstraints)),
    citations,
  };
}

export function diagnoseFailure(input: TriageInput): TriageOutput {
  const observation = pickPrimaryObservation(input.observations);
  const topDomFinding = flattenFinding(observation) ?? '';
  const failedStep = observation?.failedStep ?? 'flow-failed';
  const visibleError = observation?.observedBehavior ?? '';
  const consoleErrors = flattenErrors(observation?.consoleErrors);
  const networkErrors = flattenErrors(observation?.networkErrors);
  const bugType = classifyBugType({
    flowGoal: input.flowGoal,
    failedStep,
    visibleError,
    domFinding: topDomFinding,
    consoleErrors,
    networkErrors,
  });
  const severity = inferSeverity(input.flowGoal, input.baselineRisk, bugType);
  const likelyFiles = inferLikelyFiles({ bugType, flowGoal: input.flowGoal, domFinding: topDomFinding });
  const matchingFailureCount = input.observations.filter((o) => o.status === 'failed' || o.status === 'errored').length;
  const reusedMemory = Object.keys(input.memory.priorPatchMemory).length > 0 || Object.keys(input.memory.priorBugMemory).length > 0;
  const policyMatched = input.policy.acceptanceCriteria.length > 0 || input.policy.severityGuidance.length > 0;
  const confidenceScore = toConfidenceScore({
    observationCount: input.observations.length,
    matchingFailureCount,
    reusedMemory,
    policyMatched,
  });
  const confidence = toConfidenceLabel(confidenceScore);
  const suspectedCause = buildSuspectedCause({ bugType, visibleError, topDomFinding });
  const hypothesis = buildHypothesis({ bugType, flowGoal: input.flowGoal, failedStep, topDomFinding, likelyFiles });
  const summary = `FlowPR triaged ${bugType.replace(/_/g, ' ')} at step ${failedStep} with ${confidence} confidence.`;
  const baselineCriteria: Array<{ text: string; source?: string }> = [
    { text: input.flowGoal, source: 'dashboard_input' },
    { text: 'Primary CTAs must be reachable, visible, and unobstructed on the declared viewport.', source: 'flowpr_policy_phase5' },
  ];
  const acceptanceCriteria = input.policy.acceptanceCriteria.length > 0
    ? [...baselineCriteria, ...input.policy.acceptanceCriteria.slice(0, 4)]
    : baselineCriteria;
  const signature = buildBugSignatureParts({ bugType, failedStep, topDomFinding, flowGoal: input.flowGoal });
  const evidence: TriageEvidence = {
    provider: observation?.provider ?? 'mixed',
    providerRunId: observation?.providerRunId,
    failedStep,
    visibleError,
    finalUrl: observation?.result && typeof (observation.result as Record<string, unknown>).finalUrl === 'string'
      ? String((observation.result as Record<string, unknown>).finalUrl)
      : undefined,
    topDomFinding,
    screenshotUrl: observation?.screenshotUrl,
    traceUrl: observation?.traceUrl,
    consoleErrors,
    networkErrors,
  };

  return {
    bugType,
    severity,
    confidence,
    confidenceScore,
    hypothesis,
    summary,
    likelyFiles,
    suspectedCause,
    acceptanceCriteria,
    evidence,
    signature,
    reusedMemory,
  };
}

function buildHypothesis(input: {
  bugType: BugType;
  flowGoal: string;
  failedStep: string;
  topDomFinding: string;
  likelyFiles: string[];
}): string {
  switch (input.bugType) {
    case 'blocked_cta':
      return `The primary CTA for "${input.flowGoal}" is present in the DOM but obstructed at the viewport click target by ${input.topDomFinding || 'an overlay'}. Likely stacking context issue in ${input.likelyFiles.join(', ')}.`;
    case 'client_navigation_failure':
      return `Client navigation from step ${input.failedStep} does not complete. Likely missing handler or broken router link in ${input.likelyFiles.join(', ')}.`;
    case 'auth_redirect_failure':
      return `The flow requires authentication and the auth redirect is mis-routing before reaching ${input.failedStep}. Inspect ${input.likelyFiles.join(', ')}.`;
    case 'network_error':
      return `A required backend request fails during ${input.failedStep}. Inspect the fetch call and error surface in ${input.likelyFiles.join(', ')}.`;
    case 'responsive_layout_regression':
      return `The responsive layout at the requested viewport hides or displaces the primary CTA for "${input.flowGoal}". Inspect ${input.likelyFiles.join(', ')}.`;
    default:
      return `The browser flow "${input.flowGoal}" did not complete at step ${input.failedStep}. Investigate ${input.likelyFiles.join(', ')}.`;
  }
}

function buildSuspectedCause(input: { bugType: BugType; visibleError: string; topDomFinding: string }): string {
  if (input.bugType === 'blocked_cta') {
    return input.topDomFinding
      ? `Top element at the CTA center is ${input.topDomFinding}, which obstructs the clickable primary action.`
      : 'The primary CTA element is present but not the topmost node at its center, indicating an overlay z-index conflict.';
  }

  return input.visibleError || 'Derived from the browser observation; see evidence for full context.';
}
