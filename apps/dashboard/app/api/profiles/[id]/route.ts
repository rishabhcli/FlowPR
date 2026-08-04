import { NextResponse } from 'next/server';
import { parseFlowProfileInput } from '@flowpr/schemas';
import {
  deleteFlowProfile,
  getFlowProfile,
  updateFlowProfile,
} from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ownerOrUnauthorized() {
  const ownerKey = await getOwnerKey();
  return ownerKey
    ? { ownerKey }
    : { response: NextResponse.json({ error: 'Sign in to manage flow profiles.' }, { status: 401 }) };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await ownerOrUnauthorized();
  if ('response' in access) return access.response;
  const { id } = await context.params;

  try {
    const profile = await getFlowProfile(access.ownerKey, id);
    return profile
      ? NextResponse.json({ profile })
      : NextResponse.json({ error: 'Flow profile not found.' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await ownerOrUnauthorized();
  if ('response' in access) return access.response;
  const { id } = await context.params;

  try {
    const raw = await request.json() as Record<string, unknown>;
    const input = Object.keys(raw).length === 1 && typeof raw.enabled === 'boolean'
      ? { enabled: raw.enabled }
      : parseFlowProfileInput(raw);
    return NextResponse.json({ profile: await updateFlowProfile(access.ownerKey, id, input) });
  } catch (error) {
    const errorText = message(error);
    const status = /not found/i.test(errorText) ? 404 : /is required|must be|valid URL|github|already exists/i.test(errorText) ? 400 : 500;
    return NextResponse.json({ error: errorText }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await ownerOrUnauthorized();
  if ('response' in access) return access.response;
  const { id } = await context.params;

  try {
    await deleteFlowProfile(access.ownerKey, id);
    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    const errorText = message(error);
    return NextResponse.json({ error: errorText }, { status: /not found/i.test(errorText) ? 404 : 500 });
  }
}
