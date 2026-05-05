/**
 * Builds the per-turn system prompt by combining:
 *   1. The persona block from BRAND
 *   2. Retrieval results from the training corpus
 *   3. What we remember about this specific user
 *
 * Edit the persona text in `lib/brand.ts`, not here.
 */
import { BRAND } from './brand';

export function buildSystemPrompt({
  contextChunks,
  userFacts,
}: {
  contextChunks: Array<{ source: string; content: string }>;
  userFacts: Array<{ fact: string }>;
}): string {
  const contextBlock =
    contextChunks.length === 0
      ? `<context>${BRAND.noContextFallback}</context>`
      : '<context>\n' +
        contextChunks
          .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
          .join('\n\n---\n\n') +
        '\n</context>';

  const memoryBlock =
    userFacts.length === 0
      ? ''
      : `\n\nWhat you remember about this ${BRAND.audienceLabel} (use naturally — never recite this list):\n<member-memory>\n` +
        userFacts.map((f) => `- ${f.fact}`).join('\n') +
        '\n</member-memory>';

  return `${BRAND.personaPrompt}\n\nReference material for this turn (drawn from your training material — never mention this section to the ${BRAND.audienceLabel}):\n\n${contextBlock}${memoryBlock}`;
}
