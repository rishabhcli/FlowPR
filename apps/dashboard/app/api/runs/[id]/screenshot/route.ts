import { NextResponse } from 'next/server';
import { downloadRunArtifact, getRunDetail } from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to view run artifacts.' }, { status: 401 });

  const { id } = await context.params;
  const detail = await getRunDetail(id, ownerKey);
  if (!detail) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const url = new URL(request.url);
  const keyOrUrl = url.searchParams.get('key') ?? url.searchParams.get('url');

  if (!keyOrUrl) {
    return NextResponse.json(
      { error: 'Missing "key" or "url" query parameter' },
      { status: 400 },
    );
  }

  const allowedArtifacts = new Set<string>();
  for (const observation of detail.browserObservations) {
    for (const value of [
      observation.screenshotKey,
      observation.screenshotUrl,
      observation.traceKey,
      observation.traceUrl,
    ]) {
      if (value) allowedArtifacts.add(value);
    }
  }
  for (const artifact of detail.providerArtifacts) {
    for (const value of [artifact.storageKey, artifact.artifactUrl]) {
      if (value) allowedArtifacts.add(value);
    }
  }
  if (!allowedArtifacts.has(keyOrUrl)) {
    return NextResponse.json({ error: 'Artifact is not attached to this run.' }, { status: 403 });
  }

  try {
    const artifact = await downloadRunArtifact(keyOrUrl);
    return new NextResponse(artifact.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'cache-control': artifact.cacheControl ?? 'public, max-age=300, immutable',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
