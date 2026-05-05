/**
 * Auto-extracted user memory.
 *
 * After each conversation turn, we look at the recent messages and ask the
 * model to extract durable facts about the user — things worth remembering
 * across future chats. Each fact is deduplicated against existing memory by
 * embedding similarity before being stored.
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { UIMessage } from 'ai';
import { embedBatch } from './embed';
import { saveUserFact } from './db';
import { BRAND } from './brand';

const FactsSchema = z.object({
  facts: z.array(z.string()).max(8),
});

const EXTRACTION_SYSTEM = `You analyze conversations between a user and their coach.

Your job: extract DURABLE FACTS about the user — things worth remembering in future conversations. Output 0–8 short, atomic facts as JSON.

EXTRACT facts that are:
- Personal context (their business, role, audience, situation)
- Goals, struggles, or recurring themes ("user has been launching every quarter")
- Preferences ("user prefers blunt feedback to gentle reframes")
- Specific commitments ("user is launching X on May 5th")
- Stated identity / values ("considers herself a 'femme entrepreneur'")

DO NOT extract:
- One-off questions or fleeting details
- Things the COACH said (only facts about the USER)
- Generic frameworks or coaching advice (those live elsewhere)
- Speculation — only extract what was clearly said

Each fact should be:
- A complete sentence under 25 words
- Phrased about the user in third person, e.g. "User runs..." or "User's audience is..."
- Specific enough to be useful, not generic ("user wants to grow" — too vague)

Respond with JSON only, schema: { "facts": ["..."] }
If nothing meets the bar, respond { "facts": [] }.`;

function messageToText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ');
}

/**
 * Extract facts from the last few turns and save the new ones (dedup by embedding).
 * Fire-and-forget from the route handler — failures are logged, never thrown.
 */
export async function extractAndStoreFacts({
  userId,
  chatId,
  messages,
}: {
  userId: string;
  chatId: string;
  messages: UIMessage[];
}): Promise<void> {
  // Look at the most recent ~6 turns for context.
  const recent = messages.slice(-6);
  if (recent.length < 2) return;

  const transcript = recent
    .map((m) => `${m.role.toUpperCase()}: ${messageToText(m)}`)
    .join('\n\n');

  let parsed: { facts: string[] };
  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: EXTRACTION_SYSTEM,
      prompt: `Conversation:\n\n${transcript}\n\nExtract durable user facts as JSON.`,
      // Force JSON output via response format if the SDK supports it; otherwise rely on system prompt.
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    parsed = FactsSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    console.error('[memory] extract failed:', err instanceof Error ? err.message : err);
    return;
  }

  if (parsed.facts.length === 0) return;

  let embeddings: number[][];
  try {
    embeddings = await embedBatch(parsed.facts);
  } catch (err) {
    console.error('[memory] embed failed:', err instanceof Error ? err.message : err);
    return;
  }

  let saved = 0;
  let deduped = 0;
  for (let i = 0; i < parsed.facts.length; i++) {
    try {
      const inserted = await saveUserFact({
        userId,
        fact: parsed.facts[i],
        embedding: embeddings[i],
        sourceChatId: chatId,
      });
      if (inserted) saved++;
      else deduped++;
    } catch (err) {
      console.error('[memory] save failed:', err instanceof Error ? err.message : err);
    }
  }

  console.log(`[memory] user=${userId} chat=${chatId} extracted=${parsed.facts.length} saved=${saved} deduped=${deduped}`);
}
