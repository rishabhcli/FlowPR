import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'FlowPR',
  description: 'Autonomous frontend QA engineer with live browser proof.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

