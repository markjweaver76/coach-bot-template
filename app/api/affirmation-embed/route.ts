/**
 * /api/affirmation-embed — embed-key-authenticated affirmation generator.
 * Same logic as /api/affirmation but no Supabase user required.
 *
 * POST { messages: Array<{ from: 'mary'|'me', text: string }> }
 * Header: x-embed-key: <EMBED_SECRET>
 * Returns { lines: string[], theme: string, identityWord: string }
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { BRAND } from '@/lib/brand';

export const maxDuration = 30;

const SYSTEM = `You are Coach Mary's inner voice — distilling the essence of a coaching conversation into a personal affirmation.

Read the conversation and identify:
1. The core wound or struggle she named
2. The reframe or insight that emerged
3. The identity she is stepping into

Write a 3-line affirmation — personal, powerful, first person ("I am…", "I trust…", "I choose…"). Each line stands alone and lands like a truth she already knows but needed to hear again.

Also identify:
- theme: one short phrase (e.g. "releasing people-pleasing", "trusting the void")
- identityWord: one word she is becoming (e.g. "sovereign", "magnetic", "light", "free")

Respond ONLY with valid JSON:
{ "lines": ["...", "...", "..."], "theme": "...", "identityWord": "..." }`;

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  if (!process.env.EMBED_SECRET || embedKey !== process.env.EMBED_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages }: { messages: Array<{ from: string; text: string }> } = await req.json();
  if (!messages || messages.length < 4) {
    return Response.json({ lines: [], theme: '', identityWord: '' });
  }

  const transcript = messages
    .filter((m) => m.from === 'mary' || m.from === 'me')
    .map((m) => `${m.from === 'mary' ? 'Coach Mary' : 'Woman'}: ${m.text}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: SYSTEM,
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
