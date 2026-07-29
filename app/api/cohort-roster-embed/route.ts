/**
 * /api/cohort-roster-embed — cohort roster for the Studio "Roster" surface.
 *
 * Embed-key gated (same pattern as admin-embed / chat-embed) so the Express Studio
 * server can call it without a Supabase session. Never expose this URL publicly.
 *
 * Returns check-in COMPLETION ONLY (who checked in, how many days missed) — never
 * any member's mood/energy/stress/sleep values. Those wellbeing numbers are only
 * ever seen in aggregate.
 *
 * Query: ?slug=<cohort-slug> (defaults to the launch cohort).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getCohortRoster } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const DEFAULT_SLUG = 'regulated-radiant-reset-1';

export async function GET(req: NextRequest) {
  const key = req.headers.get('x-embed-key') ?? '';
  if (key !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get('slug') || DEFAULT_SLUG;
  try {
    const roster = await getCohortRoster(slug);
    return NextResponse.json(roster);
  } catch (err) {
    console.error('[cohort-roster-embed] error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
