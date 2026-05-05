import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          background: '#fafafa',
          color: '#111',
        }}
      >
        {children}
      </body>
    </html>
  );
}
