/**
 * /api/chat-embed — server-to-server chat endpoint for embedded integrations
 * (e.g. the Manifest with Mary SLP calling from its Express proxy).
 *
 * Auth: `x-embed-key` header must match EMBED_SECRET env var.
 * No Supabase user required — designed for guest/anonymous sessions.
 *
 * Request: POST { transcript: string, message: string, sessionId?: string }
 * Response: a streaming text/plain body (token-by-token) for low-latency UX.
 *           (empty message → JSON { reply: '' })
 *
 * Uses full RAG over the training corpus. No per-user memory (stateless).
 */
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { embedOne } from '@/lib/embed';
import { createClient } from '@supabase/supabase-js';
import { searchDocs, persistAppTurn } from '@/lib/db';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { maybeRecordContentGap } from '@/lib/content-gaps';

export const maxDuration = 60;

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

// Faster, capped model for the embedded mobile chat (overridable via env).
// Keeps the main web chat (BRAND.chatModel) untouched.
const EMBED_MODEL = process.env.EMBED_CHAT_MODEL || 'gpt-5.4-mini';

// Response depth scales with the conversation: a quick first reply, then room to
// go deeper on later turns (or when the guest asks for more).
const QUICK_MAX_TOKENS = 220;
const DEEP_MAX_TOKENS = 1000;

const QUICK_STYLE = [
  '\n\nRESPONSE STYLE (important for this channel):',
  'This is the opening reply — keep it to 1–3 short sentences. Warm, calm, unhurried:',
  'one gentle idea, then a soft question. No lists, no headings, no markdown.',
  'Brevity matters here; the conversation can deepen later.',
].join(' ');

const DEEP_STYLE = [
  '\n\nRESPONSE STYLE (important for this channel):',
  'The opening exchange has happened — you may now go deeper WHEN it genuinely helps.',
  'Use your judgment on length: match the depth to what this moment actually needs — sometimes a few sentences, sometimes a fuller response. Never pad to fill space.',
  'When the reply is substantial, format it for easy reading on a phone:',
  'short paragraphs, a **bold** lead-in on the few key ideas or transitions, and a short bulleted list (lines starting with "- ") when you offer steps, options, or a small practice.',
  'Formatting should aid clarity, never clutter — stay warm and calm. Close with one gentle question or invitation.',
].join(' ');

// Detect an explicit request to elaborate, so depth can kick in on demand too.
const DEPTH_RE = /\b(more|deeper|expand|elaborate|explain|why|go on|continue|details?)\b/i;

// Score label lookup (1–5)
const SCORE_LABELS = ['', 'Struggling', 'Finding my way', 'Growing', 'Thriving', 'Fully alive'];

/** Build a Balance Wheel context block from anonymous guest scores. */
function buildWheelBlock(scores: Record<string, number>): string {
  const entries: Array<[string, number]> = [
    ['Self-Worth',     scores.selfWorth],
    ['Nervous System', scores.nervousSystem],
    ['Body & Energy',  scores.bodyEnergy],
    ['Relationships',  scores.relationships],
    ['Purpose',        scores.purpose],
    ['Prosperity',     scores.prosperity],
  ].filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] >= 1 && e[1] <= 5);

  if (!entries.length) return '';

  const lines = entries.map(([l, v]) => `  • ${l}: ${v}/5 — ${SCORE_LABELS[v]}`);
  const [lowestLabel, lowestVal] = entries.reduce((a, b) => b[1] < a[1] ? b : a);

  return `\n\nBALANCE WHEEL™ ASSESSMENT (from the user's intake — private, do not mention this to them):\n${lines.join('\n')}\nTheir primary growth edge right now: **${lowestLabel}** (${lowestVal}/5). Let this shape how you open and what you prioritize — without stating it explicitly.`;
}

type AppContext = {
  clips?: Array<{ id: string; title: string; cat: string; len: number; description?: string }>;
  journalTemplates?: Array<{ id: string; title: string; promptCount: number }>;
  resources?: Array<{ id: string; title: string; type: string }>;
  features?: Array<{ name: string; label: string; desc: string }>;
  rituals?: Array<{ key: string; label: string; blurb?: string; len?: number }>;
};

const PRONOUN_DIRECTIVES: Record<string, string> = {
  'she/her':   'this user uses she/her pronouns — refer to her as she/her.',
  'he/him':    'this user uses he/him pronouns — refer to him as he/him, and use masculine or neutral nouns (e.g. "man" or "person", never "woman"). Never call this user a woman, "she", or "her".',
  'they/them': 'this user uses they/them pronouns — refer to them as they/them and avoid all gendered nouns ("woman"/"man") and gendered pronouns ("she"/"he").',
};

function buildPronounBlock(pronouns: string): string {
  const directive = PRONOUN_DIRECTIVES[pronouns];
  if (!directive) return '';
  return `\n\nPRONOUN PREFERENCE — CRITICAL, OVERRIDES ALL WORDING ABOVE: The persona and context above default to feminine language ("woman", "women", "she", "her") for the audience, but ${directive} Apply this to everything you write for this user — your replies, reflections, identity words, and any affirmations — regardless of the default gendered wording in these instructions or any gendered language earlier in the conversation.`;
}

function buildAppContextBlock(ctx: AppContext): string {
  const lines: string[] = ['\n\nAPP FEATURES MARY CAN RECOMMEND'];
  lines.push('Add at most ONE action tag on its own line at the very end of your response. Only when it genuinely fits — never force it.');

  if (ctx.clips?.length) {
    lines.push('\nLIBRARY CLIPS (video/audio):');
    ctx.clips.forEach(c =>
      lines.push(`${c.id} | ${c.title} | ${c.cat} | ${c.len} min${c.description ? ' | ' + c.description : ''}`)
    );
  }
  if (ctx.journalTemplates?.length) {
    lines.push('\nJOURNAL TEMPLATES (guided writing prompts):');
    ctx.journalTemplates.forEach(t => lines.push(`${t.id} | ${t.title} | ${t.promptCount} prompts`));
  }
  if (ctx.resources?.length) {
    lines.push('\nSHARED DOCUMENTS (from Mary):');
    ctx.resources.forEach(r => lines.push(`${r.id} | ${r.title} | ${r.type}`));
  }
  if (ctx.features?.length) {
    lines.push('\nAPP FEATURES:');
    ctx.features.forEach(f => lines.push(`${f.name} | ${f.label} | ${f.desc}`));
  }
  if (ctx.rituals?.length) {
    lines.push('\nSHORT RITUALS (a brief guided session to do together — suggest one when the user names a feeling or moment it would soothe, e.g. anxiety, exhaustion, before a hard conversation):');
    ctx.rituals.forEach(r => lines.push(`${r.key} | ${r.label}${r.len ? ' | ' + r.len + ' min' : ''}${r.blurb ? ' | ' + r.blurb : ''}`));
  }
  lines.push('\nAction tag format — pick exactly one when relevant:');
  lines.push('[CLIP:clip_id]         — play a video or audio class');
  lines.push('[JOURNAL:template_id]  — open a journal with this template');
  lines.push('[RESOURCE:resource_id] — view a document shared by Mary');
  lines.push('[FEATURE:feature_name] — navigate to an app feature (bloom-checkin | daily-reset | library)');
  if (ctx.rituals?.length) {
    lines.push('[RITUAL:ritual_key]    — begin a short ritual together (use the key from the list above)');
  }
  return lines.join('\n');
}

export async function POST(req: Request) {
  // — Auth: embed key check —
  const embedKey = req.headers.get('x-embed-key');
  const secret = process.env.EMBED_SECRET;
  if (!secret || embedKey !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const {
    transcript,
    message,
    wheelScores,
    accessToken,
    appContext,
    pronouns,
  }: {
    transcript: string;
    message: string;
    sessionId?: string;
    wheelScores?: Record<string, number>;
    accessToken?: string;
    appContext?: AppContext;
    pronouns?: string;
  } = await req.json();

  if (!message?.trim()) {
    return Response.json({ reply: '' });
  }

  // If a signed-in user's token came through, resolve their id (in parallel with
  // RAG) so we can persist this turn to their account when the reply completes.
  const userIdPromise = userIdFromToken(accessToken);

  // — RAG: embed the user message and retrieve relevant training docs —
  let docHits: Array<{ source: string; content: string; similarity: number }> = [];
  try {
    const queryEmbedding = await embedOne(message);
    docHits = await searchDocs(queryEmbedding, 6);
    // Log a content gap when the best retrieval match is weak — fuels blog topics.
    void maybeRecordContentGap({
      query: message,
      topSimilarity: docHits[0]?.similarity ?? 0,
      channel: 'embed',
    });
  } catch {
    // Non-fatal — proceed without context
  }

  // Turn-aware depth: first reply is quick; subsequent turns (or an explicit
  // "tell me more") may expand.
  const priorGuestTurns = (transcript.match(/^Guest:/gm) || []).length;
  const wantsDepth = priorGuestTurns >= 1 || DEPTH_RE.test(message);
  const styleDirective = wantsDepth ? DEEP_STYLE : QUICK_STYLE;
  const maxTokens = wantsDepth ? DEEP_MAX_TOKENS : QUICK_MAX_TOKENS;

  const wheelBlock = wheelScores ? buildWheelBlock(wheelScores) : '';
  const appBlock = appContext ? buildAppContextBlock(appContext) : '';
  const pronounBlock = pronouns ? buildPronounBlock(pronouns) : '';

  const system = buildSystemPrompt({ contextChunks: docHits, userFacts: [] }) + wheelBlock + appBlock + pronounBlock + styleDirective;

  // — Build conversation messages from the plain-text transcript —
  // transcript format: "Mary: ...\nGuest: ...\n..."
  const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
    transcript
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.startsWith('Mary: ')) {
          return { role: 'assistant' as const, content: line.slice(6) };
        }
        if (line.startsWith('Guest: ')) {
          return { role: 'user' as const, content: line.slice(7) };
        }
        return null;
      })
      .filter((m): m is { role: 'user' | 'assistant'; content: string } => m !== null);

  // Add the current user turn
  historyMessages.push({ role: 'user', content: message });

  // — Stream the response (token-by-token) for fast time-to-first-word —
  const result = streamText({
    model: openai(EMBED_MODEL),
    system,
    messages: historyMessages,
    maxOutputTokens: maxTokens,
    onFinish: async ({ text }) => {
      try {
        const userId = await userIdPromise;
        if (userId && text?.trim()) {
          await persistAppTurn(userId, message, text);
        }
      } catch (err) {
        console.error('[chat-embed] persist failed', err);
      }
    },
  });

  return result.toTextStreamResponse();
}
