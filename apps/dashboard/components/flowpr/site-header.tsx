'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

const links = [
  { href: '/', label: 'Command Center' },
  { href: '/demo', label: 'Demo' },
  { href: '/health', label: 'Health' },
];

export function SiteHeader() {
  const pathname = usePathname() ?? '/';

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2.5">
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

        <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground md:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <Activity className="h-3 w-3" />
          live
        </div>
      </div>
    </header>
  );
}
