/**
 * Builds the per-turn system prompt by combining:
 *   1. The persona block from BRAND
 *   2. Retrieval results from the training corpus
 *   3. What we remember about this specific user
 *
 * Edit the persona text in `lib/brand.ts`, not here.
 */
import { BRAND } from './brand';
import { matchPublicSource } from './blog-sources';
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
  // Split retrieval into two buckets:
  //   • private — the training corpus (file-path sources). Never revealed.
  //   • public  — posts from our configured blogs (see lib/blog-sources.ts).
  //     These are public articles the bot MAY cite and link as further reading.
  const privateChunks: typeof contextChunks = [];
  const publicChunks: Array<{ source: string; content: string; label: string }> = [];
  for (const c of contextChunks) {
    const pub = matchPublicSource(c.source);
    if (pub) publicChunks.push({ ...c, label: pub.label });
    else privateChunks.push(c);
  }

  const contextBlock =
    privateChunks.length === 0
      ? `<context>${BRAND.noContextFallback}</context>`
      : '<context>\n' +
        privateChunks
          .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
          .join('\n\n---\n\n') +
        '\n</context>';

  // Further Reading — public blog articles the bot is explicitly allowed to link.
  // Dedupe by URL so the same post retrieved as several chunks shows once.
  let furtherReadingBlock = '';
  if (publicChunks.length > 0) {
    const byUrl = new Map<string, { label: string; content: string }>();
    for (const c of publicChunks) {
      if (!byUrl.has(c.source)) byUrl.set(c.source, { label: c.label, content: c.content });
    }
    const articles = [...byUrl.entries()]
      .map(([url, v], i) => `[${i + 1}] ${v.label} — ${url}\n${v.content}`)
      .join('\n\n---\n\n');
    furtherReadingBlock = `\n\nFURTHER READING (public articles you MAY share — this is the ONE exception to the "never mention your sources" rule):
These are published, public blog posts from ${[...new Set(publicChunks.map((c) => c.label))].join(' and ')}. When one genuinely fits what the ${BRAND.audienceLabel} is working through, you may naturally point her to it as education or a next step — the same way you'd suggest a class, never as a sales pitch and never forced. Weave it in warmly (e.g. "there's a lovely piece on exactly this…") and include the link. Rules: only ever share a URL that appears verbatim below — never invent, guess, or modify a link; share at most one per reply; and lead with your own coaching, using the article as a gentle follow-on, not a replacement for meeting her where she is.
<further-reading>
${articles}
</further-reading>`;
  }

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

  return `${BRAND.personaPrompt}\n\nReference material for this turn (drawn from your training material — never mention this section to the ${BRAND.audienceLabel}):\n\n${contextBlock}${furtherReadingBlock}${memoryBlock}${intakeBlock}${journeyBlock}`;
}
