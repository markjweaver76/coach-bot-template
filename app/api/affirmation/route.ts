/**
 * /api/affirmation — generates a personalized 3-line affirmation from a chat session.
 *
 * Called client-side after 3+ exchanges. Requires auth (same session user).
 * POST { messages: Array<{ role: 'user' | 'assistant', text: string }> }
 * Returns { lines: string[], theme: string, identityWord: string }
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getUser } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

export const maxDuration = 30;

const SYSTEM = `You are Coach Mary's inner voice — distilling the essence of a coaching conversation into a personal affirmation for the woman you just spoke with.

Read the conversation and identify:
1. The core wound or struggle she named
2. The reframe or insight that emerged
3. The identity she is stepping into

Then write a 3-line affirmation — personal, powerful, in first person ("I am…", "I trust…", "I choose…"). Each line should stand alone and land like a truth she already knows but needed to hear again.

Also identify:
- theme: one short phrase naming the session's core theme (e.g. "releasing people-pleasing", "trusting the void", "reclaiming self-worth")
- identityWord: one word she is becoming (e.g. "sovereign", "magnetic", "light", "free")

Respond ONLY with valid JSON:
{
  "lines": ["line 1", "line 2", "line 3"],
  "theme": "...",
  "identityWord": "..."
}`;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { messages }: { messages: Array<{ role: string; text: string }> } = await req.json();
  if (!messages || messages.length < 4) {
    return Response.json({ lines: [], theme: '', identityWord: '' });
  }

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'Woman' : 'Coach Mary'}: ${m.text}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: SYSTEM,
      prompt: `Here is the coaching conversation:\n\n${transcript}\n\nGenerate the affirmation JSON.`,
    });

    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const parsed = JSON.parse(cleaned);

    return Response.json({
      lines: parsed.lines ?? [],
      theme: parsed.theme ?? '',
      identityWord: parsed.identityWord ?? '',
    });
  } catch (err) {
    console.error('[affirmation] failed:', err);
    return Response.json({ lines: [], theme: '', identityWord: '' }, { status: 500 });
  }
}
