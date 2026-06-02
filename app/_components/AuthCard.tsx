'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { BRAND } from '@/lib/brand';

export function AuthCard({ mode, nextPath }: { mode: 'login' | 'signup'; nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createClient();
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(nextPath || '/');
        router.refresh();
      } else {
        const { error, data } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push(nextPath || '/');
          router.refresh();
        } else {
          setInfo('Check your email for a confirmation link.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = email.trim() && password && !loading;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: `
        radial-gradient(80% 55% at 15% 10%, var(--teal-mist), transparent 70%),
        radial-gradient(70% 50% at 85% 85%, var(--blush-mist), transparent 70%),
        var(--cream)
      `,
    }}>
      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>

        {/* Logo / wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          {BRAND.logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={BRAND.logoSrc} alt={BRAND.name} style={{ width: 'min(240px, 60%)', height: 'auto', display: 'inline-block' }} />
          ) : (
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 'clamp(26px, 6vw, 42px)', letterSpacing: '0.08em', color: 'var(--teal-deep)', lineHeight: 1, textTransform: 'uppercase' }}>
                {BRAND.name.split(' ').slice(0, -1).join(' ') || BRAND.name}
              </div>
              {BRAND.name.split(' ').length > 1 && (
                <div style={{ fontFamily: 'var(--font-script)', fontSize: 'clamp(32px, 8vw, 56px)', color: 'var(--ink)', lineHeight: 0.9, marginTop: 2 }}>
                  {BRAND.name.split(' ').slice(-1)[0]}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Heading */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--teal-deep)', marginBottom: 6 }}>
            {mode === 'login' ? 'Welcome back' : 'Begin your journey'}
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 'clamp(22px, 5vw, 32px)', color: 'var(--ink)', margin: 0, lineHeight: 1.1 }}>
            {mode === 'login' ? BRAND.loginHeading : BRAND.signupHeading}
          </h1>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            padding: '28px 28px 24px',
            boxShadow: 'var(--sh-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            style={inputStyle}
          />

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1.4 }}>{error}</div>
          )}
          {info && (
            <div style={{ color: 'var(--success)', fontSize: 13, lineHeight: 1.4 }}>{info}</div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginTop: 4,
              padding: '13px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: canSubmit ? 'var(--teal)' : 'var(--line)',
              color: canSubmit ? 'var(--surface)' : 'var(--ink-4)',
              cursor: loading ? 'wait' : canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? 'var(--sh-teal)' : 'none',
              transition: `background var(--dur-quick) var(--ease-calm), box-shadow var(--dur-quick) var(--ease-calm)`,
            }}
          >
            {loading ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {mode === 'login' ? (
              <>
                New here?{' '}
                <Link href={`/signup${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`} style={{ color: 'var(--teal-deep)', fontWeight: 500, textDecoration: 'none' }}>
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link href={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`} style={{ color: 'var(--teal-deep)', fontWeight: 500, textDecoration: 'none' }}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        </form>

        {/* Ambient glow under card */}
        <div aria-hidden style={{
          position: 'absolute',
          left: '8%', right: '8%', bottom: -28,
          height: 56,
          borderRadius: 999,
          background: 'linear-gradient(90deg, var(--blush) 0%, var(--teal-soft) 50%, var(--coral-soft) 100%)',
          filter: 'blur(24px)',
          opacity: 0.55,
          zIndex: -1,
          pointerEvents: 'none',
        }} />

        {/* Tagline */}
        <div style={{ textAlign: 'center', marginTop: 44, fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {BRAND.tagline}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 14,
  fontFamily: 'var(--font-sans)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  outline: 'none',
  background: 'var(--surface-sink)',
  color: 'var(--ink)',
  boxShadow: 'var(--sh-inset)',
  width: '100%',
};
