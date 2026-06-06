/**
 * /api/session-summary-embed — generates and emails a session summary.
 * Embed-key authenticated, no Supabase user required.
 *
 * POST { messages: Array<{ from: 'mary'|'me', text: string }>, email: string }
 * Header: x-embed-key: <EMBED_SECRET>
 * Returns { ok: true } or { error: string }
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Resend } from 'resend';
import { BRAND } from '@/lib/brand';

export const maxDuration = 45;

const EXTRACT_SYSTEM = `You are Coach Mary's assistant. Read this coaching conversation and extract a session summary.

Return ONLY valid JSON:
{
  "insights": ["insight 1", "insight 2", "insight 3"],
  "affirmation": ["line 1", "line 2", "line 3"],
  "practice": "one clear actionable practice",
  "identityWord": "one word she is becoming"
}

Insights: 3-5 key reframes or breakthroughs specific to THIS conversation (not generic advice).
Affirmation: 3 first-person lines ("I am…", "I trust…", "I choose…").
Practice: one concrete thing she can do today or this week.`;

function buildEmailHtml({ insights, affirmation, practice, identityWord, sessionDate }: {
  insights: string[]; affirmation: string[]; practice: string; identityWord: string; sessionDate: string;
}): string {
  const insightItems = insights
    .map(i => `<li style="margin-bottom:10px;color:#5C5249;font-size:15px;line-height:1.6;">${i}</li>`)
    .join('');
  const affLines = affirmation
    .map(l => `<div style="margin-bottom:10px;font-family:'Georgia',serif;font-size:18px;color:#2F7E7A;font-style:italic;">${l}</div>`)
    .join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF3E8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF3E8;padding:40px 20px;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="text-align:center;padding-bottom:32px;">
  <div style="font-family:'Georgia',serif;font-size:13px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:6px;">MANIFEST WITH MARY</div>
  <div style="font-family:'Georgia',serif;font-size:28px;color:#2C2722;font-style:italic;">Your session summary</div>
  <div style="font-size:13px;color:#8B8175;margin-top:4px;">${sessionDate}</div>
</td></tr>
<tr><td style="background:#FFFDF9;border:1px solid #EBE0D0;border-radius:20px;padding:28px 32px;">
  <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:16px;">What emerged today</div>
  <ul style="margin:0;padding:0 0 0 18px;">${insightItems}</ul>
</td></tr>
<tr><td style="height:16px;"></td></tr>
<tr><td style="background:linear-gradient(135deg,#E6F2F0,#FCF1F2);border-radius:20px;padding:28px 32px;text-align:center;">
  <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:20px;">Your affirmation</div>
  ${affLines}
  ${identityWord ? `<div style="margin-top:16px;display:inline-block;background:#2F7E7A;color:#FFFDF9;font-size:12px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;padding:6px 16px;border-radius:999px;">I am ${identityWord}</div>` : ''}
</td></tr>
${practice ? `<tr><td style="height:16px;"></td></tr>
<tr><td style="background:#FFFDF9;border:1px solid #EBE0D0;border-radius:20px;padding:24px 32px;">
  <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:12px;">Your practice</div>
  <div style="color:#5C5249;font-size:15px;line-height:1.7;">${practice}</div>
</td></tr>` : ''}
<tr><td style="height:16px;"></td></tr>
<tr><td style="text-align:center;padding-top:8px;border-top:1px solid #EBE0D0;">
  <div style="font-family:'Georgia',serif;font-size:14px;color:#8B8175;font-style:italic;margin-bottom:4px;">Breathe easy,</div>
  <div style="font-family:'Georgia',serif;font-size:20px;color:#2C2722;font-style:italic;">— Mary</div>
  <div style="font-size:12px;color:#B6AC9F;margin-top:12px;letter-spacing:0.1em;text-transform:uppercase;">Manifest with Mary · Tropical Refuge</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  if (!process.env.EMBED_SECRET || embedKey !== process.env.EMBED_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, email }: {
    messages: Array<{ from: string; text: string }>;
    email: string;
  } = await req.json();

  if (!email || !messages || messages.length < 4) {
    return Response.json({ error: 'Need email and at least 4 messages' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Response.json({ error: 'Email not configured' }, { status: 503 });

  const transcript = messages
    .filter(m => m.from === 'mary' || m.from === 'me')
    .slice(-12)
    .map(m => `${m.from === 'mary' ? 'Coach Mary' : 'Woman'}: ${m.text}`)
    .join('\n\n');

  let summary: { insights: string[]; affirmation: string[]; practice: string; identityWord: string };
  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: EXTRACT_SYSTEM,
      prompt: `Session:\n\n${transcript}\n\nExtract summary JSON.`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    summary = JSON.parse(cleaned);
  } catch (err) {
    console.error('[session-summary-embed] extraction failed:', err);
    return Response.json({ error: 'Summary generation failed' }, { status: 500 });
  }

  const sessionDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'Coach Mary <mary@manifestwithmary.com>',
      to: email,
      subject: `Your session with Coach Mary — ${sessionDate}`,
      html: buildEmailHtml({ ...summary, sessionDate }),
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[session-summary-embed] send failed:', err);
    return Response.json({ error: 'Email send failed' }, { status: 500 });
  }
}
