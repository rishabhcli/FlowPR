import { NextResponse } from 'next/server';
import { downloadRunArtifact } from '@flowpr/tools/insforge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, _context: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url);
  const keyOrUrl = url.searchParams.get('key') ?? url.searchParams.get('url');

  if (!keyOrUrl) {
    return NextResponse.json(
      { error: 'Missing "key" or "url" query parameter' },
      { status: 400 },
    );
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
