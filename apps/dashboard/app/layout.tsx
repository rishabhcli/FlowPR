import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FlowPR — Autonomous Frontend QA',
    template: '%s · FlowPR',
  },
  description:
    'Describe a journey, point at a preview URL. FlowPR drives the browser, explains the failure, opens a fix, re-verifies, and ships a PR.',
  applicationName: 'FlowPR',
  openGraph: {
    title: 'FlowPR — Autonomous Frontend QA',
    description:
      'Real browser proof, autonomous fixes, pull requests with evidence — all from a flow goal and a preview URL.',
    siteName: 'FlowPR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FlowPR — Autonomous Frontend QA',
    description:
      'Real browser proof, autonomous fixes, pull requests with evidence — all from a flow goal and a preview URL.',
  },
};

export const viewport: Viewport = {
  themeColor: '#131210',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
