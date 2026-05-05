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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400, position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND.logoSrc}
          alt={BRAND.name}
          style={{ width: 'min(280px, 70%)', height: 'auto', display: 'block', margin: '0 auto 24px' }}
        />
        <h1 style={{ textAlign: 'center', fontSize: 22, fontWeight: 600, margin: '0 0 24px' }}>
          {mode === 'login' ? BRAND.loginHeading : BRAND.signupHeading}
        </h1>

        <form
          onSubmit={onSubmit}
          style={{
            background: '#fff',
            border: '1px solid #d8d8d8',
            borderRadius: 18,
            padding: 24,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            zIndex: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
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
            <div style={{ color: '#c43657', fontSize: 14, lineHeight: 1.4 }}>{error}</div>
          )}
          {info && (
            <div style={{ color: '#0a6e3f', fontSize: 14, lineHeight: 1.4 }}>{info}</div>
          )}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            style={{
              padding: '12px 16px',
              fontSize: 15,
              fontWeight: 500,
              border: 'none',
              borderRadius: 12,
              background: loading || !email.trim() || !password ? '#e5e5e5' : '#111',
              color: '#fff',
              cursor: loading ? 'wait' : 'pointer',
              marginTop: 4,
            }}
          >
            {loading ? '...' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 13, color: '#666', marginTop: 4 }}>
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <Link href={`/signup${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`} style={{ color: '#111', fontWeight: 500 }}>
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link href={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`} style={{ color: '#111', fontWeight: 500 }}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        </form>

        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '4%',
            right: '4%',
            bottom: -34,
            height: 64,
            borderRadius: 999,
            background:
              'linear-gradient(90deg, #ff8fa3 0%, #d6a4ff 25%, #8db8ff 50%, #7fe2c8 72%, #f7e88a 100%)',
            filter: 'blur(28px)',
            opacity: 0.6,
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 15,
  border: '1px solid #ddd',
  borderRadius: 10,
  outline: 'none',
  background: '#fff',
};
