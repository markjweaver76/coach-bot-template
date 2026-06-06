/**
 * Builds the per-turn system prompt by combining:
 *   1. The persona block from BRAND
 *   2. Retrieval results from the training corpus
 *   3. What we remember about this specific user
 *
 * Edit the persona text in `lib/brand.ts`, not here.
 */
import { BRAND } from './brand';
import type { Journey } from './journey';
import { PHASES } from './journey';
import type { Intake } from './intake';
import { SCORE_LABELS } from './intake';

export function buildSystemPrompt({
  contextChunks,
  userFacts,
  journey,
  intake,
}: {
  contextChunks: Array<{ source: string; content: string }>;
  userFacts: Array<{ fact: string }>;
  journey?: Journey | null;
  intake?: Intake | null;
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

  // Journey block — phase + homework follow-up
  let journeyBlock = '';
  if (journey) {
    const phaseInfo = PHASES[journey.phase];
    journeyBlock = `\n\nJOURNEY CONTEXT (private — never recite these details to the ${BRAND.audienceLabel}):
This woman is currently in Phase ${journey.phase} of the Tropical Refuge Method™: **${journey.phaseName}**.${journey.phaseWhy ? ` ${journey.phaseWhy}` : ''}
Key themes for this phase: ${phaseInfo?.keywords.join(', ')}.
Let this shape how you meet her — meet her where she is in the journey.`;

    if (journey.homework) {
      journeyBlock += `\n\nHOMEWORK FOLLOW-UP: Last session you assigned her this practice: "${journey.homework}"
If this is the opening of a new conversation (she's just saying hello or checking in), warmly and naturally ask how the practice went before moving into new territory. Keep it conversational — one gentle question, not a formal check-in. If the conversation is already mid-flow, weave in a reference if it naturally fits.`;
    }
  }

  // Intake / Balance Wheel block
  let intakeBlock = '';
  if (intake) {
    const fmt = (score: number, label: string) =>
      `  • ${label}: ${score}/5 — ${SCORE_LABELS[score]}`;
    const scores = [
      fmt(intake.selfWorth,     'Self-Worth'),
      fmt(intake.nervousSystem, 'Nervous System'),
      fmt(intake.bodyEnergy,    'Body & Energy'),
      fmt(intake.relationships, 'Relationships'),
      fmt(intake.purpose,       'Purpose'),
      fmt(intake.prosperity,    'Prosperity'),
    ];
    // Identify the lowest scoring dimension to name her primary growth edge
    const entries: Array<[string, number]> = [
      ['Self-Worth', intake.selfWorth], ['Nervous System', intake.nervousSystem],
      ['Body & Energy', intake.bodyEnergy], ['Relationships', intake.relationships],
      ['Purpose', intake.purpose], ['Prosperity', intake.prosperity],
    ];
    const [lowestLabel, lowestVal] = entries.reduce((a, b) => b[1] < a[1] ? b : a);

    intakeBlock = `\n\nBALANCE WHEEL™ ASSESSMENT (completed at sign-up — private, never recite to ${BRAND.audienceLabel}):
${scores.join('\n')}
Her primary growth edge right now: **${lowestLabel}** (${lowestVal}/5). Let this inform how you open, what you prioritize, and where you gently focus — without stating it explicitly.`;
  }

  return `${BRAND.personaPrompt}\n\nReference material for this turn (drawn from your training material — never mention this section to the ${BRAND.audienceLabel}):\n\n${contextBlock}${memoryBlock}${intakeBlock}${journeyBlock}`;
}
