'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }
  return (
    <button
      onClick={handleSignOut}
      style={{
        fontFamily: 'var(--font-sans)', fontSize: 12,
        color: 'var(--ink-3)', background: 'transparent',
        border: '1px solid var(--line)', borderRadius: 'var(--r-pill)',
        padding: '6px 14px', cursor: 'pointer', letterSpacing: '0.02em',
      }}
    >
      Sign out
    </button>
  );
}
