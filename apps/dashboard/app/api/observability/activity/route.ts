import { NextResponse } from 'next/server';
import { listRecentRuns, listTimelineEvents } from '@flowpr/tools';
import type { FlowPrRun, TimelineEvent } from '@flowpr/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActivityEntry extends TimelineEvent {
  flowGoal: string;
  repo: string;
  runStatus: string;
}

function shortFlowGoal(goal: string, max = 80): string {
  if (goal.length <= max) return goal;
  return `${goal.slice(0, max - 1).trim()}…`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runWindow = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('runs') ?? '5', 10), 1),
    10,
  );
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('limit') ?? '40', 10), 1),
    200,
  );

  let runs: FlowPrRun[] = [];
  try {
    runs = await listRecentRuns(runWindow);
  } catch (error) {
    return NextResponse.json(
      {
        entries: [],
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 },
    );
  }

  const collected: ActivityEntry[] = [];
  for (const run of runs) {
    try {
      const events = await listTimelineEvents(run.id);
      const recent = events.slice(-Math.ceil(limit / runWindow) * 2);
      for (const event of recent) {
        collected.push({
          ...event,
          flowGoal: shortFlowGoal(run.flowGoal),
          repo: `${run.owner}/${run.repo}`,
          runStatus: run.status,
        });
      }
    } catch {
      // skip runs whose timeline fails to load
    }
  }

  collected.sort((a, b) => {
    const tsA = new Date(a.createdAt).getTime();
    const tsB = new Date(b.createdAt).getTime();
    return tsB - tsA;
  });

  return NextResponse.json({
    entries: collected.slice(0, limit),
    generatedAt: new Date().toISOString(),
  });
}
