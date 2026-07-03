/**
 * /api/plan-embed — embed-key-authenticated personalized 4-week plan generator
 * for the Manifest with Mary app.
 *
 * Generates a bespoke manifestation/wellness arc from the user's goal + Balance
 * Wheel scores + a short recent-chat digest + pronouns, in Coach Mary's voice,
 * with strict wellness-not-therapy guardrails and a validated JSON shape. The
 * Express app server proxies to this; the app persists + renders the result, and
 * falls back to its static arcs if this is ever unavailable.
 *
 * POST {
 *   goal?: string,                 // e.g. "Grow my business"
 *   wheelScores?: Record<string, number>,  // 6 dims, 1-5
 *   recentChat?: Array<{ from: 'mary'|'me', text: string }>,
 *   pronouns?: string,
 *   accessToken?: string           // optional; identifies the user (not required to generate)
 * }
 * Header: x-embed-key: <EMBED_SECRET>
 * Returns { plan: Plan | null }
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { BRAND } from '@/lib/brand';

export const maxDuration = 30;

// The 6 Balance Wheel™ dimensions, with the label the model should use.
const WHEEL_LABELS: Record<string, string> = {
  selfWorth: 'Self-Worth',
  nervousSystem: 'Nervous System',
  bodyEnergy: 'Body & Energy',
  relationships: 'Relationships',
  purpose: 'Purpose',
  prosperity: 'Prosperity',
};

const PRONOUN_DIRECTIVES: Record<string, string> = {
  'she/her': 'The person uses she/her pronouns.',
  'he/him': 'The person uses he/him pronouns — never use feminine identity nouns like "woman"/"daughter"/"goddess"/"queen".',
  'they/them': 'The person uses they/them pronouns — use strictly gender-neutral language throughout.',
};

const SYSTEM = `You are Coach Mary, designing a gentle, personalized 4-week manifestation & wellness plan for one person in the "Manifest with Mary" app.

Voice: warm, grounded, spiritually attuned, permission-giving, present-tense — Mary's voice. Second person. Calm and unhurried. Words you love: sanctuary, ritual, breath, ground, soften, arrive, tend, bloom, recharge.

Design a 4-week arc that moves the person toward their goal, meeting them where their Balance Wheel scores say they are. Weight the early weeks toward their LOWEST-scoring dimensions (regulate the nervous system / rebuild self-worth first if those are low), then build toward aligned action and integration. Let the recent conversation, if any, shape the themes so it feels like it was written for them.

Each week has:
- theme: 3-5 words, evocative (e.g. "Clear the old story")
- focus: the Balance Wheel dimension this week centers (one of: Self-Worth, Nervous System, Body & Energy, Relationships, Purpose, Prosperity)
- practices: 2-3 short, concrete daily practices (each ≤ 6 words, e.g. "Morning breathwork", "One brave message")
- note: one gentle sentence of guidance in Mary's voice

Hard constraints:
- This is WELLNESS coaching, NOT therapy or medical advice. Never diagnose, never promise outcomes, never give medical/clinical/financial directives. No supplements, no dosages, no "cure".
- If the person's data suggests real distress, keep the plan gentle and grounding — do not attempt to treat it; the app handles crisis support separately.
- Keep it doable and kind. No hustle/grind language. No exclamation marks, no emoji.

Respond with ONLY valid JSON, no markdown fences:
{
  "goalLabel": "short restatement of their goal",
  "summary": "1-2 warm sentences framing the 4-week journey",
  "weeks": [
    { "n": 1, "theme": "...", "focus": "...", "practices": ["...","..."], "note": "..." },
    { "n": 2, "theme": "...", "focus": "...", "practices": ["...","..."], "note": "..." },
    { "n": 3, "theme": "...", "focus": "...", "practices": ["...","..."], "note": "..." },
    { "n": 4, "theme": "...", "focus": "...", "practices": ["...","..."], "note": "..." }
  ]
}`;

type Week = { n: number; theme: string; focus: string; practices: string[]; note: string };
type Plan = { goalLabel: string; summary: string; weeks: Week[] };

const clampStr = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);

// Validate + sanitize the model's JSON into a safe Plan, or null if unusable.
function coercePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const weeksRaw = Array.isArray(o.weeks) ? o.weeks : [];
  if (weeksRaw.length < 4) return null;
  const weeks: Week[] = weeksRaw.slice(0, 4).map((w, i) => {
    const wo = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
    const practices = (Array.isArray(wo.practices) ? wo.practices : [])
      .map((p) => clampStr(p, 48))
      .filter(Boolean)
      .slice(0, 3);
    return {
      n: i + 1,
      theme: clampStr(wo.theme, 60) || `Week ${i + 1}`,
      focus: clampStr(wo.focus, 40),
      practices,
      note: clampStr(wo.note, 200),
    };
  });
  if (weeks.some((w) => !w.theme || w.practices.length === 0)) return null;
  return {
    goalLabel: clampStr(o.goalLabel, 80) || 'Your journey',
    summary: clampStr(o.summary, 280),
    weeks,
  };
}

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  if (!process.env.EMBED_SECRET || embedKey !== process.env.EMBED_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: {
    goal?: string;
    wheelScores?: Record<string, number>;
    recentChat?: Array<{ from: string; text: string }>;
    pronouns?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ plan: null }, { status: 400 });
  }

  const goal = clampStr(body.goal, 80) || 'feel more like myself';
  const scores = body.wheelScores && typeof body.wheelScores === 'object' ? body.wheelScores : {};
  const wheelLines = Object.entries(WHEEL_LABELS)
    .map(([k, label]) => (typeof scores[k] === 'number' ? `- ${label}: ${scores[k]}/5` : null))
    .filter(Boolean)
    .join('\n');
  const digest = (Array.isArray(body.recentChat) ? body.recentChat : [])
    .filter((m) => m && (m.from === 'mary' || m.from === 'me') && typeof m.text === 'string')
    .slice(-12)
    .map((m) => `${m.from === 'mary' ? 'Mary' : 'Person'}: ${clampStr(m.text, 240)}`)
    .join('\n');
  const pronounNote = body.pronouns && PRONOUN_DIRECTIVES[body.pronouns]
    ? `\n\nPRONOUN PREFERENCE — honor throughout: ${PRONOUN_DIRECTIVES[body.pronouns]}`
    : '';

  const prompt = `Goal they want to call in: ${goal}

Balance Wheel scores (1 = struggling, 5 = thriving):
${wheelLines || '(not provided — keep the plan broadly gentle and grounding)'}
${digest ? `\nRecent conversation with Mary (for context — weave in the themes, don't quote it):\n${digest}` : ''}

Write the personalized 4-week plan JSON now.`;

  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: SYSTEM + pronounNote,
      prompt,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const plan = coercePlan(JSON.parse(cleaned));
    return Response.json({ plan });
  } catch (err) {
    console.error('[plan-embed] failed:', err);
    return Response.json({ plan: null }, { status: 500 });
  }
}
