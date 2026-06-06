/**
 * /dashboard — Coach Mary's private community overview.
 *
 * Access control:
 *   - Must be logged in (middleware handles redirect to /login)
 *   - Email must match ADMIN_EMAIL env var (if set)
 *     → Set ADMIN_EMAIL in Vercel env to Mary's login email to lock this down
 *     → If ADMIN_EMAIL is unset, any authenticated user can view (setup mode)
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getUser } from '@/lib/supabase/server';
import { getUserSummaries, calcStats, type UserSummary } from '@/lib/admin';
import { BRAND } from '@/lib/brand';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

// ── Phase colours (matches Sidebar) ─────────────────────────────────────────
const PHASE_COLORS: Record<number, string> = {
  1: '#9DAD8C', 2: '#4FB1AC', 3: '#ED9E7E',
  4: '#DDA0A8', 5: '#C6A079', 6: '#c8a25f',
};

// ── Wheel dimension labels ────────────────────────────────────────────────────
const WHEEL_LABELS: Array<[string, keyof NonNullable<UserSummary['wheelScores']>]> = [
  ['Self-Worth',     'selfWorth'],
  ['Nervous System', 'nervousSystem'],
  ['Body & Energy',  'bodyEnergy'],
  ['Relationships',  'relationships'],
  ['Purpose',        'purpose'],
  ['Prosperity',     'prosperity'],
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (hours < 1)  return 'just now';
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days} days ago`;
  if (days < 14)  return '1 week ago';
  if (days < 30)  return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function statusColor(daysInactive: number | null): { dot: string; border: string; label: string } {
  if (daysInactive === null)   return { dot: '#B6AC9F', border: 'var(--line)', label: 'No sessions' };
  if (daysInactive < 7)        return { dot: '#7F9A6E', border: 'var(--line)', label: 'Active'       };
  if (daysInactive < 14)       return { dot: '#C6A079', border: '#f0dfc0',    label: `${daysInactive}d ago` };
  return                              { dot: '#E84057', border: '#f5c8cf',    label: `${daysInactive}d ago` };
}

function lowestWheel(scores: NonNullable<UserSummary['wheelScores']>): string {
  let lowestLabel = 'Self-Worth';
  let lowestVal = 6;
  for (const [label, key] of WHEEL_LABELS) {
    if (scores[key] < lowestVal) { lowestVal = scores[key]; lowestLabel = label; }
  }
  return lowestLabel;
}

// ── User card ─────────────────────────────────────────────────────────────────
function UserCard({ u }: { u: UserSummary }) {
  const status = statusColor(u.daysInactive);
  const phaseColor = PHASE_COLORS[u.phase] ?? 'var(--teal)';
  const needsAttention = (u.daysInactive ?? 999) >= 7;

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${needsAttention && u.daysInactive !== null ? status.border : 'var(--line)'}`,
      borderRadius: 18,
      padding: '18px 20px 16px',
      boxShadow: 'var(--sh-sm, 0 2px 8px rgba(80,60,40,0.07))',
      display: 'flex', flexDirection: 'column', gap: 12,
      position: 'relative',
    }}>
      {/* Status dot + email */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
            color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {u.email}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: status.dot, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--ink-3)' }}>
              {u.lastSessionAt ? status.label : 'No sessions yet'}
            </span>
          </div>
        </div>
        {/* Intake badge */}
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0,
          color: u.intakeCompleted ? 'var(--teal-deep)' : 'var(--ink-4)',
          background: u.intakeCompleted ? 'var(--teal-mist)' : 'var(--canvas)',
          border: `1px solid ${u.intakeCompleted ? 'var(--line-teal)' : 'var(--line)'}`,
          borderRadius: 'var(--r-pill)', padding: '3px 9px',
        }}>
          {u.intakeCompleted ? '✓ Intake' : '— Intake'}
        </span>
      </div>

      {/* Phase */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: phaseColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: '#fff',
          }}>
            {u.phase}
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 15, color: 'var(--ink)', lineHeight: 1.2 }}>
            {u.phaseName}
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <div key={p} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: p <= u.phase ? phaseColor : 'var(--line)',
              opacity: p < u.phase ? 0.5 : 1,
            }} />
          ))}
        </div>
      </div>

      {/* Balance Wheel growth edge */}
      {u.wheelScores && (
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Growth edge:</span>{' '}
          {lowestWheel(u.wheelScores)}
          {' '}({u.wheelScores[WHEEL_LABELS.find(([, k]) => u.wheelScores![k] === Math.min(...WHEEL_LABELS.map(([, k]) => u.wheelScores![k])))?.[1] ?? 'selfWorth']}/5)
        </div>
      )}

      {/* Homework */}
      <div style={{
        background: u.homework ? 'var(--blush-mist, #fcf1f2)' : 'var(--canvas)',
        border: `1px solid ${u.homework ? 'var(--blush, #efcfd3)' : 'var(--line)'}`,
        borderRadius: 10, padding: '8px 12px', minHeight: 52,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: u.homework ? 'var(--blush-ink, #9C5B62)' : 'var(--ink-4)', marginBottom: 3 }}>
            Practice
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: u.homework ? 'var(--ink-2)' : 'var(--ink-4)', lineHeight: 1.4, fontStyle: u.homework ? 'normal' : 'italic' }}>
            {u.homework
              ? (u.homework.length > 90 ? u.homework.slice(0, 90) + '…' : u.homework)
              : 'No practice assigned yet'}
          </div>
        </div>
      </div>

      {/* Footer: session count + last active */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--line)' }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--ink-4)' }}>
          {u.totalChats} {u.totalChats === 1 ? 'session' : 'sessions'}
        </span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: needsAttention && u.daysInactive !== null ? status.dot : 'var(--ink-4)', fontWeight: needsAttention ? 500 : 400 }}>
          {u.lastSessionAt ? relativeTime(u.lastSessionAt) : 'Never'}
        </span>
      </div>
    </div>
  );
}

// ── Stat chip ─────────────────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 16, padding: '18px 22px',
      boxShadow: 'var(--sh-sm, 0 2px 8px rgba(80,60,40,0.07))',
    }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 44, fontWeight: 500, color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  // Admin gate — if ADMIN_EMAIL is set, enforce it
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && user.email !== adminEmail) redirect('/');

  let users: UserSummary[] = [];
  let fetchError: string | null = null;
  try {
    users = await getUserSummaries();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load data';
  }

  const stats = calcStats(users);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream, #FAF3E8)', paddingBottom: 80 }}>

      {/* ── Sticky header ── */}
      <div style={{
        borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(250,243,232,0.92)', backdropFilter: 'blur(12px)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {BRAND.logoSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={BRAND.logoSrc} alt={BRAND.name} style={{ height: 34, width: 'auto' }} />
            )}
            <div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--teal-deep)', lineHeight: 1 }}>
                Community
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22, color: 'var(--ink)', lineHeight: 1.1 }}>
                Dashboard
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/" style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--teal-deep)', textDecoration: 'none', letterSpacing: '0.02em' }}>
              ← Back to chat
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 32px 0' }}>

        {/* Setup note if ADMIN_EMAIL not set */}
        {!adminEmail && (
          <div style={{ marginBottom: 24, padding: '12px 18px', background: 'var(--teal-mist)', border: '1px solid var(--line-teal)', borderRadius: 12, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--teal-deep)' }}>
            <strong>Setup tip:</strong> Add <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>ADMIN_EMAIL=your@email.com</code> to Vercel env vars to restrict this dashboard to your account only.
          </div>
        )}

        {/* Error state */}
        {fetchError && (
          <div style={{ padding: '16px 20px', background: '#fef2f3', border: '1px solid #f5c8cf', borderRadius: 12, fontFamily: 'var(--font-sans)', fontSize: 13, color: '#9C3A47', marginBottom: 24 }}>
            ⚠ Could not load data: {fetchError}
          </div>
        )}

        {/* ── Stats row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 36 }}>
          <StatChip label="Total members"     value={stats.total}          color="var(--teal)"       />
          <StatChip label="Active this week"  value={stats.activeThisWeek} color="#7F9A6E"           />
          <StatChip label="Need follow-up"    value={stats.needFollowUp}   color="#E84057"           />
          <StatChip label="Practice assigned" value={stats.withHomework}   color="var(--gold, #c8a25f)" />
        </div>

        {/* ── User cards ── */}
        {users.length === 0 && !fetchError ? (
          <div style={{ textAlign: 'center', padding: '80px 0', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18, color: 'var(--ink-3)' }}>
            No members yet — your community is waiting, beautiful.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
            {users.map((u) => (
              <UserCard key={u.userId} u={u} />
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        {users.length > 0 && (
          <div style={{ marginTop: 40, textAlign: 'center', fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.05em' }}>
            {users.length} member{users.length !== 1 ? 's' : ''} · refreshed on page load ·{' '}
            <a href="/dashboard" style={{ color: 'var(--teal-deep)', textDecoration: 'none' }}>refresh</a>
          </div>
        )}
      </div>
    </div>
  );
}
