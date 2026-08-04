import { NextResponse } from 'next/server';
import { validateRunEvidenceIntegrity, type RunDetail } from '@flowpr/schemas';
import { getRunDetail, recordProviderArtifact } from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function markdownPacket(detail: RunDetail, exportId: string, exportedAt: string): string {
  const { run } = detail;
  const integrityIssues = validateRunEvidenceIntegrity(detail);
  const latestPatch = detail.patches.at(-1);
  const latestPullRequest = detail.pullRequests.at(-1);
  const latestHypothesis = detail.bugHypotheses.at(-1);
  const lines = [
    '# FlowPR evidence packet',
    '',
    `Exported: ${exportedAt}`,
    `Export id: ${exportId}`,
    '',
    '## Run',
    '',
    `- Run id: ${run.id}`,
    `- Repository: ${run.owner}/${run.repo}`,
    `- Base branch: ${run.baseBranch}`,
    `- Preview: ${run.previewUrl}`,
    `- Goal: ${run.flowGoal}`,
    `- Status: ${run.status}`,
    `- Risk: ${run.riskLevel}`,
    `- Permission profile: ${run.permissionProfile}`,
    `- Created: ${run.createdAt}`,
    run.completedAt ? `- Completed: ${run.completedAt}` : '- Completed: still running',
    '',
    '## Browser observations',
    '',
  ];

  if (detail.browserObservations.length === 0) {
    lines.push('_No browser observations recorded._', '');
  } else {
    for (const observation of detail.browserObservations) {
      lines.push(
        `### ${observation.provider} · ${observation.status}`,
        '',
        `- Severity: ${observation.severity}`,
        `- Failed step: ${observation.failedStep ?? 'None recorded'}`,
        `- Expected: ${observation.expectedBehavior ?? 'Not recorded'}`,
        `- Observed: ${observation.observedBehavior ?? 'Not recorded'}`,
        `- Screenshot: ${observation.screenshotUrl ?? observation.screenshotKey ?? 'None recorded'}`,
        '',
      );
    }
  }

  lines.push('## Diagnosis', '');
  lines.push(
    latestHypothesis
      ? `- ${latestHypothesis.summary} (${latestHypothesis.confidence} confidence, ${latestHypothesis.severity} severity)`
      : '- No diagnosis recorded.',
    '',
    '## Patch and verification',
    '',
    latestPatch
      ? `- Patch: ${latestPatch.summary} (${latestPatch.status})`
      : '- Patch: none recorded',
    latestPatch?.filesChanged?.length
      ? `- Files changed: ${latestPatch.filesChanged.map((file) => String(file.path ?? file)).join(', ')}`
      : '- Files changed: none recorded',
    ...detail.verificationResults.map(
      (result) => `- Verification (${result.provider}): ${result.status} - ${result.summary}`,
    ),
    '',
    '## Pull request',
    '',
    latestPullRequest
      ? `- ${latestPullRequest.title} (${latestPullRequest.status})${latestPullRequest.url ? `: ${latestPullRequest.url}` : ''}`
      : '- No pull request recorded.',
    '',
    '## Timeline',
    '',
    ...detail.timelineEvents.map(
      (event) => `- ${event.createdAt} · ${event.phase} · ${event.status} · ${event.title}${event.detail ? ` — ${event.detail}` : ''}`,
    ),
    '',
    '## Evidence integrity',
    '',
    ...(integrityIssues.length === 0
      ? ['- Clean: no integrity issues reported.']
      : integrityIssues.map((issue) => `- ${issue.severity}: ${issue.message}`)),
    '',
    '## Provider artifact counts',
    '',
    `- Provider artifacts: ${detail.providerArtifacts.length}`,
    `- Action gates: ${detail.actionGates.length}`,
    `- Policy hits: ${detail.policyHits.length}`,
    `- Benchmark evaluations: ${detail.benchmarkEvaluations.length}`,
  );

  return `${lines.join('\n')}\n`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) {
    return NextResponse.json({ error: 'Sign in to export a run evidence packet.' }, { status: 401 });
  }

  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'markdown';

  try {
    const detail = await getRunDetail(id, ownerKey);
    if (!detail) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const exportedAt = new Date().toISOString();
    const exportId = `${id}-${format}-${Date.now()}`;
    await recordProviderArtifact({
      runId: id,
      sponsor: 'insforge',
      artifactType: 'evidence_export',
      providerId: exportId,
      requestSummary: { format, runId: id },
      responseSummary: { generatedAt: exportedAt, evidenceIntegrityIssues: validateRunEvidenceIntegrity(detail).length },
      raw: { exportId, format, generatedAt: exportedAt },
    });

    if (format === 'json') {
      const body = JSON.stringify({ exportId, exportedAt, evidenceIntegrity: validateRunEvidenceIntegrity(detail), ...detail }, null, 2);
      return new NextResponse(`${body}\n`, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="flowpr-${id}-evidence.json"`,
          'cache-control': 'no-store',
        },
      });
    }

    return new NextResponse(markdownPacket(detail, exportId, exportedAt), {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="flowpr-${id}-evidence.md"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
