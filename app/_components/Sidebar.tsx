'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ChatListItem } from '@/lib/db';
import type { Journey } from '@/lib/journey';
import { createClient } from '@/lib/supabase/client';
import { BRAND } from '@/lib/brand';

const PHASE_COLORS: Record<number, string> = {
  1: '#9DAD8C', 2: '#4FB1AC', 3: '#ED9E7E',
  4: '#DDA0A8', 5: '#C6A079', 6: '#c8a25f',
};

export function Sidebar({ chats, email, journey, isAdmin }: {
  chats: ChatListItem[];
  email: string | null;
  journey?: Journey | null;
  isAdmin?: boolean;
}) {
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

      {/* Phase tracker */}
      {journey && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          padding: '12px 14px',
          boxShadow: 'var(--sh-sm)',
        }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--teal-deep)', marginBottom: 6 }}>
            Your journey
          </div>

          {/* Phase name + number */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: PHASE_COLORS[journey.phase] ?? 'var(--teal)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: '#fff',
            }}>
              {journey.phase}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 14, color: 'var(--ink)', lineHeight: 1.2 }}>
              {journey.phaseName}
            </div>
          </div>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[1,2,3,4,5,6].map((p) => (
              <div key={p} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: p <= journey.phase
                  ? (PHASE_COLORS[journey.phase] ?? 'var(--teal)')
                  : 'var(--line)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>

          {/* Homework badge */}
          {journey.homework && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--blush-mist)', border: '1px solid var(--blush)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--blush-ink)', marginBottom: 3 }}>Practice</div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>
                {journey.homework.length > 80 ? journey.homework.slice(0, 80) + '…' : journey.homework}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Coach dashboard — admin only */}
      {isAdmin && (
        <Link
          href="/dashboard"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', fontSize: 12,
            color: 'var(--teal-deep)', textDecoration: 'none',
            border: '1px solid var(--line-teal)', borderRadius: 'var(--r-sm)',
            background: 'var(--teal-mist)', fontFamily: 'var(--font-sans)',
            fontWeight: 500, letterSpacing: '0.02em',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Community dashboard
        </Link>
      )}

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
