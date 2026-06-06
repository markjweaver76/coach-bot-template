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
import { searchDocs } from '@/lib/db';
import { buildSystemPrompt } from '@/lib/system-prompt';

export const maxDuration = 60;

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

  return `\n\nBALANCE WHEEL™ ASSESSMENT (from her intake — private, never mention this to her):\n${lines.join('\n')}\nHer primary growth edge right now: **${lowestLabel}** (${lowestVal}/5). Let this shape how you open and what you prioritize — without stating it explicitly.`;
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
  }: { transcript: string; message: string; sessionId?: string; wheelScores?: Record<string, number> } =
    await req.json();

  if (!message?.trim()) {
    return Response.json({ reply: '' });
  }

  // — RAG: embed the user message and retrieve relevant training docs —
  let docHits: Array<{ source: string; content: string; similarity: number }> = [];
  try {
    const queryEmbedding = await embedOne(message);
    docHits = await searchDocs(queryEmbedding, 6);
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
  const system = buildSystemPrompt({ contextChunks: docHits, userFacts: [] }) + wheelBlock + styleDirective;

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
  });

  return result.toTextStreamResponse();
}
