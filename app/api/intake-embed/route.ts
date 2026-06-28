/**
 * /api/intake-embed — save Balance Wheel intake from the Manifest with Mary app.
 *
 * Embed-key gated (same pattern as chat-embed, admin-embed, etc.) so the Express
 * app server can call it. The end user is identified by the Supabase access token
 * (JWT) forwarded in the body — we verify it against Supabase to resolve their id,
 * then write exactly what the cookie-authed /api/intake route writes. This is how a
 * marytomanifest.com user's wheel data lands in the community dashboard.
 *
 * Never expose this URL publicly — the embed key stays server-side.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { saveIntake, scoresToPhase, type WheelScores } from '@/lib/intake';
import { upsertPhase } from '@/lib/journey';

export const dynamic = 'force-dynamic';

const WHEEL_KEYS: (keyof WheelScores)[] = [
  'selfWorth', 'nervousSystem', 'bodyEnergy', 'relationships', 'purpose', 'prosperity',
];

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-embed-key') ?? '';
  if (key !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { accessToken?: string; scores?: Partial<WheelScores>; source?: 'intake' | 'checkin' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const accessToken = body.accessToken ?? '';
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing access token' }, { status: 401 });
  }

  // Verify the JWT against Supabase to resolve the user (no cookies involved).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  // Validate all 6 scores are present and in range
  const raw = body.scores ?? {};
  for (const k of WHEEL_KEYS) {
    const val = raw[k];
    if (typeof val !== 'number' || val < 1 || val > 5 || !Number.isInteger(val)) {
      return NextResponse.json({ error: `Invalid score for ${k}` }, { status: 400 });
    }
  }
  const scores = raw as WheelScores;

  try {
    await saveIntake(user.id, scores);
    const phase = scoresToPhase(scores);
    const why = body.source === 'checkin'
      ? 'Phase updated from your latest check-in'
      : 'Starting phase set from Balance Wheel™ intake assessment';
    await upsertPhase(user.id, phase, why);
    return NextResponse.json({ ok: true, phase });
  } catch (err) {
    console.error('[intake-embed] error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
