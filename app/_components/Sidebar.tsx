'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ChatListItem } from '@/lib/db';
import { createClient } from '@/lib/supabase/client';
import { BRAND } from '@/lib/brand';

export function Sidebar({ chats, email }: { chats: ChatListItem[]; email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeId = pathname?.startsWith('/chat/') ? pathname.split('/')[2] : null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside style={{
      width: 260,
      height: '100vh',
      background: 'var(--canvas)',
      borderRight: '1px solid var(--line)',
      padding: '20px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      position: 'sticky',
      top: 0,
      flexShrink: 0,
    }}>

      {/* Wordmark */}
      <div style={{ padding: '8px 10px 4px', textAlign: 'center' }}>
        {BRAND.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={BRAND.logoSrc} alt={BRAND.name} style={{ width: 120, height: 'auto' }} />
        ) : (
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 14, letterSpacing: '0.1em', color: 'var(--teal-deep)', textTransform: 'uppercase', lineHeight: 1 }}>
              {BRAND.name.split(' ').slice(0, -1).join(' ') || BRAND.name}
            </div>
            {BRAND.name.split(' ').length > 1 && (
              <div style={{ fontFamily: 'var(--font-script)', fontSize: 28, color: 'var(--ink)', lineHeight: 0.85, marginTop: 2 }}>
                {BRAND.name.split(' ').slice(-1)[0]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New chat */}
      <Link
        href="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '10px 14px',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: 'var(--font-sans)',
          color: 'var(--teal-deep)',
          textDecoration: 'none',
          borderRadius: 'var(--r-pill)',
          border: '1.5px solid var(--line-teal)',
          background: 'var(--surface)',
          transition: `background var(--dur-quick)`,
          letterSpacing: '0.01em',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        New session
      </Link>

      {/* Back to dashboard — only shown if configured */}
      {BRAND.dashboardUrl && (
        <a
          href={BRAND.dashboardUrl}
          style={{
            display: 'block',
            padding: '9px 14px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--surface)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Back to dashboard
        </a>
      )}

      {/* Chat list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
        <div style={{
          fontSize: 11,
          letterSpacing: '0.22em',
          color: 'var(--teal-deep)',
          padding: '6px 10px 6px',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
        }}>
          Recent
        </div>

        {chats.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
            Your sanctuary is quiet.
          </div>
        )}

        {chats.map((c) => {
          const isActive = c.id === activeId;
          return (
            <Link
              key={c.id}
              href={`/chat/${c.id}`}
              title={c.title}
              style={{
                padding: '8px 10px',
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
                color: isActive ? 'var(--teal-ink)' : 'var(--ink-2)',
                textDecoration: 'none',
                background: isActive ? 'var(--teal-mist)' : 'transparent',
                borderRadius: 'var(--r-sm)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: isActive ? 500 : 400,
                transition: `background var(--dur-quick)`,
              }}
            >
              {c.title}
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {email && (
          <div style={{
            padding: '2px 10px',
            fontSize: 11,
            color: 'var(--ink-4)',
            fontFamily: 'var(--font-sans)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }} title={email}>
            {email}
          </div>
        )}
        <button
          onClick={signOut}
          style={{
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            color: 'var(--ink-3)',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            borderRadius: 'var(--r-sm)',
            letterSpacing: '0.01em',
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
