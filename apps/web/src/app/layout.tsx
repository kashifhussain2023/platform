import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { MotionFlag } from '@/components/system/MotionFlag';

// Self-hosted at build time (no runtime request to fonts.googleapis.com) —
// exposed as a CSS variable and opted into ONLY by the dark marketing
// sections (see `font-marketing` in globals.css). The rest of the app keeps
// the Workforce Ledger system-font stack on purpose.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Orlixa — Build your AI workforce',
  description:
    'Orlixa is the AI Workforce Platform — hire managed AI Employees, equip them with Skills, brief them with your Knowledge, chain them into Workflows, and gate every risky move behind human Approvals.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <MotionFlag />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
