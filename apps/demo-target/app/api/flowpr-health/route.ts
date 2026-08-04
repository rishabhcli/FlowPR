import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(
    { service: 'flowpr-demo-target', status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
