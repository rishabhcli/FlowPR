import Link from 'next/link';
import { ArrowUpRight, Database, Github, PlayCircle, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { isLocalSessionEnabled } from '@/lib/session';

export const metadata = {
  title: 'FlowPR — Sign in',
  description: 'Sign in with GitHub to start an autonomous frontend QA run.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6">
        <header className="flex h-16 items-center justify-between border-b border-border/60">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/40">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-sm font-semibold tracking-tight">FlowPR</span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/health" className="transition hover:text-foreground">Provider health</Link>
            <Link href="/demo" className="inline-flex items-center gap-1 transition hover:text-foreground">View demo <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
        </header>

        <LoginContent searchParams={searchParams} />
      </div>
    </main>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const next = params.next ?? '/';
  const errorMessage = params.error;
  const startHref = `/api/connections/github/start?next=${encodeURIComponent(next)}`;
  const localHref = `/api/auth/local?next=${encodeURIComponent(next)}`;

  return (
    <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:gap-20">
      <div className="max-w-2xl">
        <p className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary">
          <ScanLine className="h-3.5 w-3.5" /> Autonomous frontend QA
        </p>
        <h1 className="mt-5 max-w-xl font-display text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
          FlowPR keeps the browser proof attached to the patch.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          Start from a user journey and a preview URL. FlowPR observes the live flow, records what happened, applies a focused fix, verifies it, and prepares the handoff.
        </p>

        <div className="mt-10 divide-y divide-border/70 border-y border-border/70">
          <div className="flex items-start gap-4 py-4">
            <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">Browser evidence first</p><p className="mt-1 text-xs text-muted-foreground">Observed steps, screenshots, console and network signals stay tied to the run.</p></div>
          </div>
          <div className="flex items-start gap-4 py-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">Permission-aware actions</p><p className="mt-1 text-xs text-muted-foreground">Action gates separate investigation, draft PR, and verified PR outcomes.</p></div>
          </div>
          <div className="flex items-start gap-4 py-4">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">Durable handoff</p><p className="mt-1 text-xs text-muted-foreground">Timeline, diagnosis, verification, and exportable evidence survive the browser session.</p></div>
          </div>
        </div>
      </div>

      <Card className="w-full">
        <CardHeader className="space-y-2 border-b border-border/60">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Enter command center</p>
          <h2 className="text-2xl font-semibold tracking-tight">Start a verified run</h2>
          <p className="text-sm text-muted-foreground">Connect a GitHub identity to access repositories and saved QA playbooks.</p>
        </CardHeader>
        <CardContent className="space-y-3 p-6">
          <Button asChild size="lg" className="h-11 w-full text-sm">
            <a href={startHref}><Github className="h-4 w-4" /> Continue with GitHub</a>
          </Button>

          {isLocalSessionEnabled() && (
            <Button asChild variant="outline" size="lg" className="h-11 w-full text-sm">
              <a href={localHref}>Use local development workspace</a>
            </Button>
          )}

          {errorMessage && <p className="text-xs text-destructive" role="alert">{decodeURIComponent(errorMessage)}</p>}

          <div className="border-t border-border/60 pt-4 text-center">
            <p className="text-[11px] text-muted-foreground">GitHub sign-in is handled through InsForge. No repository data is copied into this screen.</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link href="/demo" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground"><PlayCircle className="h-3.5 w-3.5" /> Watch demo</Link>
              <Link href="/health" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Provider status</Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
