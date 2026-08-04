import { NextResponse } from 'next/server';
import {
  createFlowProfile,
  listFlowProfiles,
} from '@flowpr/tools/insforge';
import { parseFlowProfileInput } from '@flowpr/schemas';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to view flow profiles.' }, { status: 401 });

  try {
    return NextResponse.json({ profiles: await listFlowProfiles(ownerKey) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to create a flow profile.' }, { status: 401 });

  try {
    const input = parseFlowProfileInput(await request.json());
    const profile = await createFlowProfile(ownerKey, input);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    const status = /already exists|is required|must be|valid URL|github/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
