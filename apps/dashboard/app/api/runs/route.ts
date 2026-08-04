import { NextResponse } from 'next/server';
import { listRecentRuns } from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  try {
    const ownerKey = await getOwnerKey();
    if (!ownerKey) return NextResponse.json({ error: 'Sign in to view run history.' }, { status: 401 });
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const status = url.searchParams.get('status')?.trim().toLowerCase() ?? '';
    const risk = url.searchParams.get('risk')?.trim().toLowerCase() ?? '';
    const repo = url.searchParams.get('repo')?.trim().toLowerCase() ?? '';
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
    const allRuns = await listRecentRuns(200, ownerKey);
    const filtered = allRuns.filter((run) => {
      if (status && run.status.toLowerCase() !== status) return false;
      if (risk && run.riskLevel.toLowerCase() !== risk) return false;
      if (repo && !`${run.owner}/${run.repo}`.toLowerCase().includes(repo)) return false;
      if (
        query &&
        ![run.flowGoal, run.owner, run.repo, run.previewUrl, run.baseBranch]
          .join(' ')
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    });
    const runs = filtered.slice(0, limit);

    return NextResponse.json({
      runs,
      total: filtered.length,
      filters: { q: query, status, risk, repo, limit },
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
