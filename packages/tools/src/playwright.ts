import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { screenshotStorageKey, traceStorageKey } from '@flowpr/schemas';
import { uploadRunArtifact } from './insforge';

export interface NetworkFailure {
  url: string;
  status?: number;
  method?: string;
}

export interface ObstructionCheck {
  obstructed: boolean;
  box?: { x: number; y: number; width: number; height: number };
  topNode?: { tag: string; text: string; className: string; id: string } | null;
}

export interface LocalFlowTestInput {
  runId: string;
  previewUrl: string;
  flowGoal: string;
  label?: string;
  timeoutMs?: number;
}

export interface LocalFlowTestResult {
  passed: boolean;
  failedStep?: string;
  visibleError?: string;
  finalUrl: string;
  screenshotUrl?: string;
  screenshotKey?: string;
  traceUrl?: string;
  traceKey?: string;
  consoleErrors: string[];
  networkErrors: NetworkFailure[];
  domFindings: string[];
  likelyRootCause?: string;
  confidence: number;
  recoveryPassed?: boolean;
  raw: Record<string, unknown>;
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function flowIncludes(goal: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(goal));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function firstVisible(candidates: Locator[]): Promise<Locator | undefined> {
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);

    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index);

      if (await item.isVisible().catch(() => false)) {
        return item;
      }
    }
  }

  return undefined;
}

export async function assertElementNotObstructed(page: Page, locator: Locator): Promise<ObstructionCheck> {
  const box = await locator.boundingBox();

  if (!box) {
    return {
      obstructed: true,
      topNode: { tag: 'UNKNOWN', text: 'Element has no bounding box', className: '', id: '' },
    };
  }

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const result = await locator.evaluate(
    (targetElement, { x, y }) => {
      const top = document.elementFromPoint(x, y);
      const topElement = top as HTMLElement | null;
      const unobstructed = Boolean(top && (top === targetElement || targetElement.contains(top)));

      return {
        obstructed: !unobstructed,
        topNode: topElement
          ? {
              tag: topElement.tagName,
              text: (topElement.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
              className: String(topElement.className ?? ''),
              id: topElement.id,
            }
          : null,
      };
    },
    center,
  );

  return { ...result, box };
}

export function extractConsoleErrors(events: string[]): string[] {
  return events.slice(0, 20);
}

export function extractNetworkFailures(events: NetworkFailure[]): NetworkFailure[] {
  return events.slice(0, 20);
}

export async function saveScreenshot(input: {
  page: Page;
  runId: string;
  label: string;
}): Promise<{ url: string; key: string }> {
  const key = screenshotStorageKey({
    runId: input.runId,
    timestamp: timestampLabel(),
    label: input.label,
  });
  const body = await input.page.screenshot({ fullPage: true });
  const upload = await uploadRunArtifact({
    key,
    body,
    contentType: 'image/png',
  });

  return { url: upload.url, key };
}

export async function captureTrace(input: {
  context: BrowserContext;
  runId: string;
  label: string;
}): Promise<{ url: string; key: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'flowpr-trace-'));
  const path = join(directory, `${input.label}.zip`);

  try {
    await input.context.tracing.stop({ path });
    const body = await readFile(path);
    const key = traceStorageKey({ runId: input.runId, label: input.label });
    const upload = await uploadRunArtifact({
      key,
      body,
      contentType: 'application/zip',
    });

    return { url: upload.url, key };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function clickIfVisible(page: Page, candidates: Locator[], label: string, actions: string[]): Promise<boolean> {
  const target = await firstVisible(candidates);

  if (!target) return false;

  await target.click({ timeout: 10000 });
  actions.push(`clicked:${label}`);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  return true;
}

async function exerciseFlow(page: Page, input: LocalFlowTestInput): Promise<{
  passed: boolean;
  failedStep?: string;
  visibleError?: string;
  domFindings: string[];
  likelyRootCause?: string;
  confidence: number;
  recoveryPassed?: boolean;
  actions: string[];
}> {
  const actions: string[] = [];
  const domFindings: string[] = [];
  const goal = input.flowGoal.toLowerCase();
  const requiresCheckout = flowIncludes(goal, [/checkout/, /pay/, /purchase/, /complete/]);

  await page.goto(input.previewUrl, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs ?? 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  actions.push(`goto:${input.previewUrl}`);

  if (flowIncludes(goal, [/pricing/, /\bpro\b/, /plan/])) {
    await clickIfVisible(
      page,
      [
        page.getByRole('link', { name: /pro/i }),
        page.getByRole('button', { name: /pro/i }),
        page.getByText(/^pro\b/i),
      ],
      'pro',
      actions,
    );
  }

  if (flowIncludes(goal, [/signup/, /sign up/, /register/])) {
    await clickIfVisible(
      page,
      [
        page.getByRole('link', { name: /sign up|signup|register|get started/i }),
        page.getByRole('button', { name: /sign up|signup|register|get started/i }),
      ],
      'signup',
      actions,
    );
  }

  if (requiresCheckout) {
    const paymentTarget = await firstVisible([
      page.getByRole('button', { name: /pay now|pay|complete checkout|checkout|purchase|submit/i }),
      page.getByRole('link', { name: /pay now|pay|complete checkout|checkout|purchase|submit/i }),
    ]);

    if (!paymentTarget) {
      return {
        passed: false,
        failedStep: 'checkout_submit',
        visibleError: 'No checkout payment action was visible.',
        domFindings,
        likelyRootCause: 'The requested checkout CTA could not be found.',
        confidence: 0.82,
        actions,
      };
    }

    const obstruction = await assertElementNotObstructed(page, paymentTarget);

    if (obstruction.obstructed) {
      domFindings.push(`CTA center is covered by ${obstruction.topNode?.tag ?? 'unknown node'} ${obstruction.topNode?.text ?? ''}`.trim());
      const accepted = await clickIfVisible(
        page,
        [page.getByRole('button', { name: /accept|agree|ok/i })],
        'recovery_accept_overlay',
        actions,
      );
      let recoveryPassed = false;

      if (accepted) {
        await paymentTarget.click({ timeout: 10000 }).catch(() => undefined);
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        recoveryPassed = /success|complete|confirmation|thank/i.test(page.url());
      }

      return {
        passed: false,
        failedStep: 'checkout_submit',
        visibleError: `Primary checkout CTA is obstructed by ${obstruction.topNode?.text || obstruction.topNode?.tag || 'another element'}.`,
        domFindings,
        likelyRootCause: 'A fixed overlay is blocking the primary checkout action on the mobile viewport.',
        confidence: 0.94,
        recoveryPassed,
        actions,
      };
    }

    await paymentTarget.click({ timeout: 10000 });
    actions.push('clicked:checkout_submit');
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  }

  const finalUrl = page.url();
  const successTextVisible = await page.getByText(/success|complete|confirmed|thank you/i).first().isVisible().catch(() => false);
  const genericSmokePassed = !requiresCheckout
    && (await page.locator('body').isVisible().catch(() => false))
    && (await page.locator('h1, [role="heading"]').first().isVisible().catch(() => false));
  const passed = /success|complete|confirmation|thank/i.test(finalUrl) || successTextVisible || genericSmokePassed;

  return {
    passed,
    failedStep: passed ? undefined : 'flow_completion',
    visibleError: passed
      ? undefined
      : requiresCheckout
        ? 'The requested flow did not reach a success state.'
        : 'The page loaded, but the requested visible state could not be confirmed.',
    domFindings,
    likelyRootCause: passed
      ? undefined
      : requiresCheckout
        ? 'Navigation or a primary action did not complete the target flow.'
        : 'The target page did not expose a visible heading or primary loaded state.',
    confidence: passed ? 0.86 : 0.72,
    actions,
  };
}

export async function runLocalFlowTest(input: LocalFlowTestInput): Promise<LocalFlowTestResult> {
  const label = input.label ?? 'phase4-local-flow';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const consoleErrors: string[] = [];
  const networkErrors: NetworkFailure[] = [];
  let trace: { url: string; key: string } | undefined;
  let screenshot: { url: string; key: string } | undefined;
  let flowResult: Awaited<ReturnType<typeof exerciseFlow>> | undefined;
  let fatalError: unknown;
  let finalUrl = input.previewUrl;

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      });
    }
  });

  try {
    flowResult = await exerciseFlow(page, input);
    finalUrl = page.url();
  } catch (error) {
    fatalError = error;
    flowResult = {
      passed: false,
      failedStep: 'playwright_flow',
      visibleError: error instanceof Error ? error.message : String(error),
      domFindings: [],
      likelyRootCause: 'The deterministic Playwright flow could not complete.',
      confidence: 0.76,
      actions: [],
    };
  } finally {
    screenshot = await saveScreenshot({ page, runId: input.runId, label }).catch(() => undefined);
    trace = await captureTrace({ context, runId: input.runId, label }).catch(() => undefined);
    await browser.close();
  }

  return {
    passed: Boolean(flowResult?.passed),
    failedStep: flowResult?.failedStep,
    visibleError: flowResult?.visibleError,
    finalUrl,
    screenshotUrl: screenshot?.url,
    screenshotKey: screenshot?.key,
    traceUrl: trace?.url,
    traceKey: trace?.key,
    consoleErrors: extractConsoleErrors(consoleErrors),
    networkErrors: extractNetworkFailures(networkErrors),
    domFindings: flowResult?.domFindings ?? [],
    likelyRootCause: flowResult?.likelyRootCause,
    confidence: flowResult?.confidence ?? 0.5,
    recoveryPassed: flowResult?.recoveryPassed,
    raw: {
      actions: flowResult?.actions ?? [],
      fatalError: fatalError instanceof Error ? fatalError.message : fatalError,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      traceCaptured: Boolean(trace),
      screenshotCaptured: Boolean(screenshot),
    },
  };
}

export async function runRemoteBrowserSessionEvidence(input: LocalFlowTestInput & {
  cdpUrl: string;
}): Promise<LocalFlowTestResult> {
  const browser = await chromium.connectOverCDP(input.cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = context.pages()[0] ?? await context.newPage();
  const label = input.label ?? 'phase4-tinyfish-browser-session';
  let screenshot: { url: string; key: string } | undefined;
  let flowResult: Awaited<ReturnType<typeof exerciseFlow>> | undefined;
  let fatalError: unknown;
  let finalUrl = input.previewUrl;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    flowResult = await exerciseFlow(page, input);
    finalUrl = page.url();
  } catch (error) {
    fatalError = error;
    flowResult = {
      passed: false,
      failedStep: 'tinyfish_browser_session',
      visibleError: error instanceof Error ? error.message : String(error),
      domFindings: [],
      likelyRootCause: 'The TinyFish Browser API CDP session could not complete the deterministic flow.',
      confidence: 0.7,
      actions: [],
    };
  } finally {
    screenshot = await saveScreenshot({ page, runId: input.runId, label }).catch(() => undefined);
    await browser.close();
  }

  return {
    passed: Boolean(flowResult?.passed),
    failedStep: flowResult?.failedStep,
    visibleError: flowResult?.visibleError,
    finalUrl,
    screenshotUrl: screenshot?.url,
    screenshotKey: screenshot?.key,
    consoleErrors: [],
    networkErrors: [],
    domFindings: flowResult?.domFindings ?? [],
    likelyRootCause: flowResult?.likelyRootCause,
    confidence: flowResult?.confidence ?? 0.5,
    recoveryPassed: flowResult?.recoveryPassed,
    raw: {
      actions: flowResult?.actions ?? [],
      fatalError: fatalError instanceof Error ? fatalError.message : fatalError,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      screenshotCaptured: Boolean(screenshot),
    },
  };
}
