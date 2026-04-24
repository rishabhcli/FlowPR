import Link from 'next/link';
import { Github, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-radial-spot opacity-90" />
      <div className="absolute inset-0 -z-10 bg-grid opacity-[0.16]" />

      <LoginContent searchParams={searchParams} />
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

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center px-6 text-center">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />
        FlowPR
      </div>

      <h1 className="font-display text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
        Frontend QA that{' '}
        <span className="text-primary">ships the patch.</span>
      </h1>

      <p className="mt-4 max-w-sm text-sm text-muted-foreground">
        Real browser proof, autonomous fixes, pull requests with evidence — all from a flow goal and a preview URL.
      </p>

      <Button asChild size="lg" className="mt-8 h-12 px-6 text-sm">
        <a href={startHref}>
          <Github className="h-4 w-4" />
          Continue with GitHub
        </a>
      </Button>

      {errorMessage && (
        <p className="mt-4 text-xs text-destructive" role="alert">
          {decodeURIComponent(errorMessage)}
        </p>
      )}

      <p className="mt-10 text-[11px] text-muted-foreground">
        By continuing you let FlowPR connect a GitHub identity through InsForge.{' '}
        <Link href="/health" className="text-foreground/80 underline-offset-4 hover:underline">
          provider status
        </Link>
      </p>
    </section>
  );
}
