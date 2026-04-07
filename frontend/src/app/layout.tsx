import './globals.css';
import type { Metadata } from 'next';
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'PlateRank',
  description: 'Rate restaurants and plates with weighted scoring.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="app-shell">{children}</main>
      </body>
    </html>
  );
}
