import { NextResponse } from 'next/server';

function normalizePlan(value: unknown): 'basic' | 'pro' {
  return value === 'pro' ? 'pro' : 'basic';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = normalizePlan(url.searchParams.get('plan'));

  return NextResponse.json({
    ok: true,
    plan,
    redirectTo: '/success',
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const plan = normalizePlan((body as Record<string, unknown>).plan);

  return NextResponse.json({
    ok: true,
    plan,
    redirectTo: '/success',
  });
}
