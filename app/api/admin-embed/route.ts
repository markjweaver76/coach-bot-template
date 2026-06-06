/**
 * /api/admin-embed — community data for the Studio dashboard.
 *
 * Embed-key gated (same pattern as chat-embed, voice-embed, etc.)
 * so the Express Studio server can call it without a Supabase session.
 * Never expose this URL publicly — the embed key stays server-side.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getUserSummaries, calcStats } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.headers.get('x-embed-key') ?? '';
  if (key !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await getUserSummaries();
    const stats = calcStats(users);
    return NextResponse.json({ users, stats });
  } catch (err) {
    console.error('[admin-embed] error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
