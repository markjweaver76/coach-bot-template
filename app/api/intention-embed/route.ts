/**
 * /api/intention-embed — a signed-in user's PERSONAL "Today's intention" (v2).
 *
 * Auth: `x-embed-key` header must match EMBED_SECRET. The user is identified by
 * a forwarded Supabase access token (no cookie/session needed).
 *
 * POST { action: 'get', accessToken }                 → { intention: string }
 * POST { action: 'set', accessToken, intention }      → { intention: string }
 *
 * 'get' returns a single line distilled from the user's recent app conversation,
 * cached per-user and regenerated only when they've chatted since it was written.
 * The Manifest Today screen layers it: personal → Mary's Studio line → default.
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClient } from '@supabase/supabase-js';
import { BRAND } from '@/lib/brand';
import {
  getUserIntention,
  setUserIntention,
  lastAppMessageAt,
  loadRecentAppMessages,
} from '@/lib/db';

export const maxDuration = 30;

const MAX_LEN = 240;

/** Resolve a Supabase user id from a forwarded access token (or null). */
async function userIdFromToken(accessToken?: string): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

const SYSTEM = `You are Coach Mary's inner voice, distilling a woman's recent conversation into ONE line she can carry as today's intention.

- Write a single sentence in second person ("Today, you…", "You are…") or as a quiet truth — warm, present-tense, affirming.
- 6–16 words. No quotation marks, no preamble, no emoji, no trailing period is required.
- Reflect the identity she is stepping into or the reframe that emerged — never a task or to-do.
- It should feel like something she already knows but needed to hear again.

Respond with ONLY the line.`;

/** Distil one intention line from recent turns. Returns '' if too little to work with. */
async function distillIntention(turns: Array<{ role: string; text: string }>): Promise<string> {
  if (turns.length < 3) return '';
  const transcript = turns
    .map((t) => `${t.role === 'assistant' ? 'Coach Mary' : 'Woman'}: ${t.text}`)
    .join('\n');
  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: SYSTEM,
      prompt: `Recent conversation:\n\n${transcript}\n\nWrite today's intention line.`,
    });
    return text
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, MAX_LEN);
  } catch (err) {
    console.error('[intention-embed] distill failed', err);
    return '';
  }
}

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  if (!process.env.EMBED_SECRET || embedKey !== process.env.EMBED_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { action, accessToken, intention }: {
    action?: 'get' | 'set';
    accessToken?: string;
    intention?: string;
  } = await req.json().catch(() => ({}));

  const userId = await userIdFromToken(accessToken);
  if (!userId) return Response.json({ intention: '' });

  // — set: store the line as-is (e.g. seeded from an affirmation) —
  if (action === 'set') {
    const text = (intention ?? '').toString().trim().slice(0, MAX_LEN);
    try {
      await setUserIntention(userId, text);
      return Response.json({ intention: text });
    } catch (err) {
      console.error('[intention-embed] set failed', err);
      return Response.json({ intention: '' }, { status: 500 });
    }
  }

  // — get: serve the cached line, regenerating only if they've chatted since —
  try {
    const [cached, lastMsg] = await Promise.all([
      getUserIntention(userId),
      lastAppMessageAt(userId),
    ]);

    // Fresh cache (or a manual set with no later conversation) → serve it.
    if (cached && (!lastMsg || cached.updatedAt >= lastMsg)) {
      return Response.json({ intention: cached.text });
    }

    // No conversation yet → nothing to distil; fall back to any cached value.
    if (!lastMsg) return Response.json({ intention: cached?.text ?? '' });

    const turns = await loadRecentAppMessages(userId, 16);
    const line = await distillIntention(turns);
    if (line) {
      await setUserIntention(userId, line);
      return Response.json({ intention: line });
    }
    // Couldn't distil → keep whatever we had (may be empty).
    return Response.json({ intention: cached?.text ?? '' });
  } catch (err) {
    console.error('[intention-embed] get failed', err);
    return Response.json({ intention: '' });
  }
}
