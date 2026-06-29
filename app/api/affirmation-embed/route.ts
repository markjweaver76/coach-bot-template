/**
 * /api/affirmation-embed — embed-key-authenticated affirmation generator.
 * Same logic as /api/affirmation but no Supabase user required.
 *
 * POST { messages: Array<{ from: 'mary'|'me', text: string }>, pronouns?: string }
 * Header: x-embed-key: <EMBED_SECRET>
 * Returns { lines: string[], theme: string, identityWord: string }
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { BRAND } from '@/lib/brand';

export const maxDuration = 30;

const SYSTEM = `You are Coach Mary's inner voice — distilling the essence of a coaching conversation into a personal affirmation for the person you just spoke with.

Read the conversation and identify:
1. The core wound or struggle they named
2. The reframe or insight that emerged
3. The identity they are stepping into

Write a 3-line affirmation — personal, powerful, first person ("I am…", "I trust…", "I choose…"). Each line stands alone and lands like a truth they already know but needed to hear again.

Do NOT assume the speaker's gender from the conversation. Unless a PRONOUN PREFERENCE below says otherwise, use gender-neutral identity language — never gendered nouns like "daughter", "woman", "sister", "goddess", "queen", "mother". Prefer neutral words ("person", "soul", "child", "human") or simply omit a gendered noun.

Also identify:
- theme: one short phrase (e.g. "releasing people-pleasing", "trusting the void")
- identityWord: one word they are becoming (e.g. "sovereign", "magnetic", "light", "free")

Respond ONLY with valid JSON:
{ "lines": ["...", "...", "..."], "theme": "...", "identityWord": "..." }`;

const PRONOUN_DIRECTIVES: Record<string, string> = {
  'she/her':   'The speaker uses she/her pronouns — feminine identity nouns (e.g. "daughter", "woman") are appropriate.',
  'he/him':    'The speaker uses he/him pronouns — use he/him and masculine or neutral identity nouns (e.g. "son", "man", "person"). NEVER use feminine words like "daughter", "woman", "she", or "her" for the speaker.',
  'they/them': 'The speaker uses they/them pronouns — use they/them and strictly gender-neutral nouns; avoid "daughter"/"son", "woman"/"man", "she"/"he".',
};

function buildPronounBlock(pronouns?: string): string {
  const directive = pronouns ? PRONOUN_DIRECTIVES[pronouns] : '';
  return directive
    ? `\n\nPRONOUN PREFERENCE — CRITICAL: ${directive} The conversation may contain feminine wording from the coach; ignore that when choosing the speaker's pronouns and identity nouns. Honor this in every line, the theme, and the identityWord.`
    : '';
}

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  if (!process.env.EMBED_SECRET || embedKey !== process.env.EMBED_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, pronouns }: { messages: Array<{ from: string; text: string }>; pronouns?: string } = await req.json();
  if (!messages || messages.length < 4) {
    return Response.json({ lines: [], theme: '', identityWord: '' });
  }

  const transcript = messages
    .filter((m) => m.from === 'mary' || m.from === 'me')
    .map((m) => `${m.from === 'mary' ? 'Coach Mary' : 'Person'}: ${m.text}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: SYSTEM + buildPronounBlock(pronouns),
      prompt: `Conversation:\n\n${transcript}\n\nGenerate the affirmation JSON.`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const parsed = JSON.parse(cleaned);
    return Response.json({ lines: parsed.lines ?? [], theme: parsed.theme ?? '', identityWord: parsed.identityWord ?? '' });
  } catch (err) {
    console.error('[affirmation-embed] failed:', err);
    return Response.json({ lines: [], theme: '', identityWord: '' }, { status: 500 });
  }
}
