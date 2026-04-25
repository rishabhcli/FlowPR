import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findRepoRoot(startDir = process.cwd()): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export async function POST() {
  const stylesPath = join(
    findRepoRoot(),
    'apps',
    'demo-target',
    'app',
    'styles.css',
  );

  if (!existsSync(stylesPath)) {
    return NextResponse.json(
      { error: `styles.css not found at ${stylesPath}` },
      { status: 500 },
    );
  }

  try {
    const current = readFileSync(stylesPath, 'utf8');
    const next = current
      .replace(
        /z-index: 30;\n  border-radius: 999px;\n  background: #111827;/,
        'z-index: 10;\n  border-radius: 999px;\n  background: #111827;',
      )
      .replace(
        /z-index: 12;\n  display: flex;/,
        'z-index: 20;\n  display: flex;',
      );

    if (next === current) {
      return NextResponse.json({
        state: 'already_broken',
        message: 'Storefront bug was already armed.',
      });
    }

    writeFileSync(stylesPath, next);
    return NextResponse.json({
      state: 'rearmed',
      message: 'Storefront bug re-armed: cookie banner covers the mobile Pay button.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
