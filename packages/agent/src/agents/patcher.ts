import type { TriageOutput } from './visual-triage';
import {
  cloneRepo,
  commitAll,
  createBranch,
  diffStatAgainstBase,
  listChangedFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type CloneRepoResult,
} from '@flowpr/tools';

const REGRESSION_TEST_PATH = 'apps/demo-target/tests/checkout-mobile-regression.spec.ts';
const PATCH_AUTHOR_NAME = 'FlowPR Autonomous Agent';
const PATCH_AUTHOR_EMAIL = 'agent@flowpr.dev';

export interface PatchPlanFile {
  path: string;
  action: 'replace' | 'patch' | 'create';
  summary: string;
}

export interface PatchPlan {
  branchName: string;
  commitMessage: string;
  files: PatchPlanFile[];
  testPath: string;
  explanation: string;
}

export interface GenerateDemoPatchInput {
  runId: string;
  repoUrl: string;
  baseBranch: string;
  triage: TriageOutput;
  authToken?: string;
}

export interface GenerateDemoPatchResult {
  workspace: CloneRepoResult;
  plan: PatchPlan;
  commitSha: string;
  filesChanged: string[];
  diffStat: { filesChanged: number; insertions: number; deletions: number };
  preFixStyles: string;
  postFixStyles: string;
  regressionTestContent: string;
  raw: Record<string, unknown>;
}

function buildBranchName(runId: string, bugType: string): string {
  const slug = bugType.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'fix';
  const shortId = runId.slice(0, 8);
  return `flowpr/${shortId}-${slug}`;
}

function buildCommitMessage(triage: TriageOutput): string {
  const title = `fix(flow): repair ${triage.bugType.replace(/_/g, ' ')}`;

  return `${title}

FlowPR diagnosed "${triage.summary}".
Root cause: ${triage.suspectedCause}
Patched files: ${triage.likelyFiles.join(', ')}
`;
}

function applyCookieBannerFix(css: string): string {
  const fixed = css
    .replace(/(\.pay-button[\s\S]*?z-index:\s*)\d+(;)/, '$130$2')
    .replace(/(\.cookie-banner[\s\S]*?z-index:\s*)\d+(;)/, '$112$2');

  return fixed;
}

function buildRegressionTest(): string {
  return `import { expect, type Locator, type Page, test } from '@playwright/test';

async function assertElementNotObstructed(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Pay now CTA has no bounding box.');
  }

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const result = await locator.evaluate(
    (targetElement, { x, y }) => {
      const top = document.elementFromPoint(x, y);
      const topElement = top as HTMLElement | null;
      const isClear = Boolean(top && (top === targetElement || targetElement.contains(top)));

      return {
        isClear,
        topNode: topElement
          ? \`\${topElement.tagName} \${(topElement.textContent ?? '').replace(/\\s+/g, ' ').trim()}\`
          : 'none',
      };
    },
    center,
  );

  expect(result.isClear, \`Pay now CTA is covered by \${result.topNode}\`).toBe(true);
}

test.describe('FlowPR regression: mobile checkout CTA is reachable', () => {
  test('pay now button is unobstructed and completes checkout on mobile', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /pro/i }).click();

    const payNow = page.getByRole('link', { name: /pay now/i });
    await expect(payNow).toBeVisible();
    await assertElementNotObstructed(page, payNow);

    await payNow.click();
    await expect(page).toHaveURL(/success/);
    await expect(page.getByRole('heading', { name: /checkout complete/i })).toBeVisible();
  });
});
`;
}

export async function generateDemoCookieBannerPatch(
  input: GenerateDemoPatchInput,
): Promise<GenerateDemoPatchResult> {
  const workspace = await cloneRepo({
    runId: input.runId,
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    depth: 2,
    authToken: input.authToken,
  });

  const branchName = buildBranchName(input.runId, input.triage.bugType);
  await createBranch({ dir: workspace.dir, branchName, baseBranch: input.baseBranch });

  const stylesPath = 'apps/demo-target/app/styles.css';
  const preFixStyles = (await readWorkspaceFile(workspace.dir, stylesPath)) ?? '';
  const postFixStyles = applyCookieBannerFix(preFixStyles);

  if (preFixStyles === postFixStyles) {
    throw new Error('Cookie banner regex did not match — workspace may already be clean.');
  }

  await writeWorkspaceFile({ dir: workspace.dir, path: stylesPath, content: postFixStyles });

  const regressionTestContent = buildRegressionTest();
  await writeWorkspaceFile({
    dir: workspace.dir,
    path: REGRESSION_TEST_PATH,
    content: regressionTestContent,
  });

  const plan: PatchPlan = {
    branchName,
    commitMessage: buildCommitMessage(input.triage),
    explanation: input.triage.hypothesis,
    testPath: REGRESSION_TEST_PATH,
    files: [
      {
        path: stylesPath,
        action: 'patch',
        summary: 'Restore stacking order so Pay now sits above the cookie banner on mobile checkout.',
      },
      {
        path: REGRESSION_TEST_PATH,
        action: 'create',
        summary: 'Add Playwright regression test that fails when the CTA is obstructed on mobile.',
      },
    ],
  };

  const { commitSha } = await commitAll({
    dir: workspace.dir,
    message: plan.commitMessage,
    authorName: PATCH_AUTHOR_NAME,
    authorEmail: PATCH_AUTHOR_EMAIL,
  });

  const [filesChanged, diffStat] = await Promise.all([
    listChangedFiles(workspace.dir, input.baseBranch),
    diffStatAgainstBase(workspace.dir, input.baseBranch),
  ]);

  return {
    workspace,
    plan,
    commitSha,
    filesChanged,
    diffStat,
    preFixStyles,
    postFixStyles,
    regressionTestContent,
    raw: {
      branchName,
      commitSha,
      diffStat,
      filesChanged,
    },
  };
}
