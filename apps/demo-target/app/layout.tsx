import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'Storefront — Pricing & Checkout',
    template: '%s · Storefront',
  },
  description: 'Sample subscription storefront.',
  applicationName: 'Storefront',
};

export const viewport: Viewport = {
  themeColor: '#f7f3ea',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="brand-header">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            Storefront
          </Link>
        </header>
        {children}
      </body>
    </html>
  );
}

