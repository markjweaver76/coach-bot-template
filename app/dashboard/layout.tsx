import type { ReactNode } from 'react';

// Dashboard has no sidebar — full-width, standalone layout.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream, #FAF3E8)' }}>
      {children}
    </div>
  );
}
