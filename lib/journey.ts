/**
 * User journey tracking — phase within the Tropical Refuge Method™ and homework.
 *
 * Phase progression (Tropical Refuge Method™):
 *   1 · Hidden Healer      — self-worth, shame, abandonment, visibility fears
 *   2 · The Awakening      — nervous system, burnout, survival mode, stress
 *   3 · Warrior Goddess    — body, movement, energy, self-care
 *   4 · Sovereign Woman    — boundaries, people-pleasing, relationships
 *   5 · The Visionary      — purpose, prosperity, vision, abundance
 *   6 · Magnetic Femme     — embodiment, visibility, leadership, presence
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { UIMessage } from 'ai';
import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  _sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 4, idle_timeout: 20 });
  return _sql;
}

export const PHASES: Record<number, { name: string; keywords: string[] }> = {
  1: { name: 'Hidden Healer',   keywords: ['self-worth', 'shame', 'abandonment', 'rejection', 'visibility', 'hiding', 'not enough', 'imposter'] },
  2: { name: 'The Awakening',   keywords: ['burnout', 'nervous system', 'survival mode', 'stress', 'exhausted', 'overwhelmed', 'freeze', 'fight or flight'] },
  3: { name: 'Warrior Goddess', keywords: ['body', 'movement', 'energy', 'self-care', 'health', 'exercise', 'inflammation', 'strength'] },
  4: { name: 'Sovereign Woman', keywords: ['boundaries', 'people-pleasing', 'relationships', 'toxic', 'overgiving', 'saying no', 'standards'] },
  5: { name: 'The Visionary',   keywords: ['purpose', 'prosperity', 'vision', 'abundance', 'money', 'business', 'calling', 'expansion'] },
  6: { name: 'Magnetic Femme',  keywords: ['embodiment', 'visibility', 'leadership', 'presence', 'magnetism', 'unapologetic', 'main character'] },
};

export type Journey = {
  userId: string;
  phase: number;
  phaseName: string;
  phaseWhy: string | null;
  homework: string | null;
  homeworkSetAt: string | null;
  updatedAt: string;
};

// ── DB helpers ──────────────────────────────────────────────────────────────

export async function getJourney(userId: string): Promise<Journey | null> {
  const sql = db();
  const rows = await sql<Array<{
    user_id: string; phase: number; phase_name: string;
    phase_why: string | null; homework: string | null;
    homework_set_at: Date | null; updated_at: Date;
  }>>`SELECT * FROM user_journey WHERE user_id = ${userId} LIMIT 1`;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    userId: r.user_id,
    phase: r.phase,
    phaseName: r.phase_name,
    phaseWhy: r.phase_why,
    homework: r.homework,
    homeworkSetAt: r.homework_set_at?.toISOString() ?? null,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function upsertPhase(userId: string, phase: number, why: string | null): Promise<void> {
  const sql = db();
  const name = PHASES[phase]?.name ?? 'Hidden Healer';
  await sql`
    INSERT INTO user_journey (user_id, phase, phase_name, phase_why)
    VALUES (${userId}, ${phase}, ${name}, ${why})
    ON CONFLICT (user_id) DO UPDATE
      SET phase = EXCLUDED.phase,
          phase_name = EXCLUDED.phase_name,
          phase_why = EXCLUDED.phase_why,
          updated_at = now()
  `;
}

export async function setHomework(userId: string, homework: string): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO user_journey (user_id, homework, homework_set_at)
    VALUES (${userId}, ${homework}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET homework = EXCLUDED.homework,
          homework_set_at = now(),
          updated_at = now()
  `;
}

export async function clearHomework(userId: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE user_journey
    SET homework = NULL, homework_set_at = NULL, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

// ── AI detection ────────────────────────────────────────────────────────────

function messageToText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text).join(' ');
}

const PHASE_SYSTEM = `You analyze coaching conversations for the Tropical Refuge Method™.

The 6 phases are:
1 · Hidden Healer     — self-worth, shame, abandonment, rejection, visibility fears, hiding true self
2 · The Awakening     — nervous system, burnout, survival mode, stress, exhaustion, feeling unsafe
3 · Warrior Goddess   — body image, movement, energy, self-care, physical health, recovery
4 · Sovereign Woman   — boundaries, people-pleasing, toxic relationships, overgiving, saying no
5 · The Visionary     — purpose, money, prosperity, vision, business, calling, abundance mindset
6 · Magnetic Femme    — embodiment, visibility, leadership, presence, magnetism, unapologetic living

Based on the conversation, identify which phase this woman is PRIMARILY working in.
Consider: what themes dominate? what pain is most alive? what growth edge is showing up?

Respond ONLY with valid JSON:
{ "phase": <1-6>, "why": "<1 sentence explaining why>" }`;

const HOMEWORK_SYSTEM = `You read a coaching conversation and extract the specific practice or homework Coach Mary assigned.

Look for: things like "try this before next session", "your practice this week", a named exercise, journaling prompt, daily ritual, or physical practice Mary clearly recommended the woman do.

If Mary assigned something specific, return it as a clear, actionable sentence.
If nothing was clearly assigned, return null.

Respond ONLY with valid JSON:
{ "homework": "<the practice>" or null }`;

export async function detectAndUpdatePhase({
  userId,
  messages,
  currentPhase,
}: {
  userId: string;
  messages: UIMessage[];
  currentPhase: number;
}): Promise<void> {
  if (messages.length < 4) return; // need a real conversation

  const recent = messages.slice(-8);
  const transcript = recent
    .map((m) => `${m.role === 'user' ? 'Woman' : 'Coach Mary'}: ${messageToText(m)}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: openai('gpt-4o-mini'), // fast + cheap for this classification
      system: PHASE_SYSTEM,
      prompt: `Current phase: ${currentPhase}. Conversation:\n\n${transcript}\n\nWhich phase is she in?`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const { phase, why } = JSON.parse(cleaned);
    if (phase >= 1 && phase <= 6) {
      await upsertPhase(userId, phase, why ?? null);
    }
  } catch (err) {
    console.error('[journey] phase detection failed:', err instanceof Error ? err.message : err);
  }
}

export async function detectAndSetHomework({
  userId,
  messages,
}: {
  userId: string;
  messages: UIMessage[];
}): Promise<void> {
  if (messages.length < 4) return;

  const lastFew = messages.slice(-6);
  const transcript = lastFew
    .map((m) => `${m.role === 'user' ? 'Woman' : 'Coach Mary'}: ${messageToText(m)}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      system: HOMEWORK_SYSTEM,
      prompt: `Conversation:\n\n${transcript}\n\nExtract homework JSON.`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const { homework } = JSON.parse(cleaned);
    if (homework && typeof homework === 'string' && homework.length > 5) {
      await setHomework(userId, homework);
    }
  } catch (err) {
    console.error('[journey] homework detection failed:', err instanceof Error ? err.message : err);
  }
}
