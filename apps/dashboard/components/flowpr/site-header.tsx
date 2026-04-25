'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Check, Github, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SystemStatusBar } from '@/components/flowpr/system-status-bar';

const links = [
  { href: '/', label: 'Command Center' },
  { href: '/demo', label: 'Demo' },
  { href: '/health', label: 'Health' },
];

interface HeaderProfile {
  login?: string;
  avatarUrl?: string;
}

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const [profile, setProfile] = useState<HeaderProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.signedIn) return;
        setProfile({
          login: body.githubLogin,
          avatarUrl: body.githubAvatarUrl,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/40 transition group-hover:bg-primary/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-sm font-semibold tracking-tight">
              FlowPR
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Autonomous QA
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const isActive =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SystemStatusBar className="hidden sm:flex" />
          <ResetDemoButton />
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-card/60 text-muted-foreground"
            title={profile?.login ?? 'GitHub'}
            aria-label={profile?.login ? `Signed in as ${profile.login}` : 'Not signed in'}
          >
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.login ? `${profile.login} avatar` : 'GitHub avatar'}
                className="h-full w-full object-cover"
              />
            ) : (
              <Github className="h-4 w-4" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

type ResetState = 'idle' | 'loading' | 'success' | 'error';

function ResetDemoButton() {
  const [state, setState] = useState<ResetState>('idle');
  const [message, setMessage] = useState<string>();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleClick() {
    if (state === 'loading') return;
    setState('loading');
    setMessage(undefined);
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Reset failed (${response.status})`);
      setState('success');
      setMessage(body.message);
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setState('idle');
        setMessage(undefined);
      }, 2400);
    }
  }

  const Icon =
    state === 'loading'
      ? Loader2
      : state === 'success'
        ? Check
        : state === 'error'
          ? X
          : RotateCcw;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      title={
        state === 'idle'
          ? 'Re-arm storefront bug for the next run'
          : (message ?? 'Reset demo')
      }
      aria-label="Reset demo"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
        state === 'success' &&
          'border-success/40 bg-success/10 text-success',
        state === 'error' &&
          'border-destructive/40 bg-destructive/10 text-destructive',
        (state === 'idle' || state === 'loading') &&
          'border-border/60 bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          state === 'loading' && 'animate-spin',
        )}
      />
      <span className="hidden md:inline">
        {state === 'success'
          ? 'Reset'
          : state === 'error'
            ? 'Failed'
            : state === 'loading'
              ? 'Resetting…'
              : 'Reset demo'}
      </span>
    </button>
  );
}
