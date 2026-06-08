/**
 * Session Summary — extracts key insights from a coaching session and
 * emails them to the user via Resend.
 *
 * Fire-and-forget from the chat route's onFinish handler.
 * Only sends if: 6+ messages, RESEND_API_KEY is set, and user has an email.
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Resend } from 'resend';
import type { UIMessage } from 'ai';
import { BRAND } from './brand';

const EXTRACT_SYSTEM = `You are Coach Mary's assistant. Read this coaching session and extract a concise summary for the woman who just had it.

Return ONLY valid JSON with this shape:
{
  "insights": ["short insight 1", "short insight 2", ...],  // 3-5 key insights or reframes from the session
  "affirmation": ["line 1", "line 2", "line 3"],           // a 3-line personal affirmation (first person)
  "practice": "one clear, actionable practice to try before the next session",
  "identityWord": "one word she is becoming"
}

Insights should be specific to THIS conversation — not generic coaching advice.
Keep each insight to 1 concise sentence. The affirmation lines should feel personal and powerful.`;

function messageToText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ');
}

function buildEmailHtml({
  insights,
  affirmation,
  practice,
  identityWord,
  sessionDate,
}: {
  insights: string[];
  affirmation: string[];
  practice: string;
  identityWord: string;
  sessionDate: string;
}): string {
  const insightItems = insights
    .map((i) => `<li style="margin-bottom:10px;color:#5C5249;font-size:15px;line-height:1.6;">${i}</li>`)
    .join('');

  const affirmationLines = affirmation
    .map((l) => `<div style="margin-bottom:10px;font-family:'Georgia',serif;font-size:18px;color:#2F7E7A;font-style:italic;">${l}</div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF3E8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF3E8;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Header -->
        <tr><td style="text-align:center;padding-bottom:32px;">
          <div style="font-family:'Georgia',serif;font-size:13px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:6px;">MANIFEST WITH MARY</div>
          <div style="font-family:'Georgia',serif;font-size:28px;color:#2C2722;font-style:italic;">Your session summary</div>
          <div style="font-size:13px;color:#8B8175;margin-top:4px;">${sessionDate}</div>
        </td></tr>

        <!-- Insights -->
        <tr><td style="background:#FFFDF9;border:1px solid #EBE0D0;border-radius:20px;padding:28px 32px;margin-bottom:20px;">
          <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:16px;">What emerged today</div>
          <ul style="margin:0;padding:0 0 0 18px;">${insightItems}</ul>
        </td></tr>

        <tr><td style="height:16px;"></td></tr>

        <!-- Affirmation -->
        <tr><td style="background:linear-gradient(135deg,#E6F2F0,#FCF1F2);border-radius:20px;padding:28px 32px;text-align:center;">
          <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:20px;">Your affirmation</div>
          ${affirmationLines}
          ${identityWord ? `<div style="margin-top:16px;display:inline-block;background:#2F7E7A;color:#FFFDF9;font-family:'Helvetica Neue',sans-serif;font-size:12px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;padding:6px 16px;border-radius:999px;">I am ${identityWord}</div>` : ''}
        </td></tr>

        <tr><td style="height:16px;"></td></tr>

        <!-- Practice -->
        ${practice ? `
        <tr><td style="background:#FFFDF9;border:1px solid #EBE0D0;border-radius:20px;padding:24px 32px;">
          <div style="font-family:'Georgia',serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#2F7E7A;margin-bottom:12px;">Your practice</div>
          <div style="color:#5C5249;font-size:15px;line-height:1.7;">${practice}</div>
        </td></tr>
        <tr><td style="height:16px;"></td></tr>
        ` : ''}

        <!-- Footer -->
        <tr><td style="text-align:center;padding-top:8px;border-top:1px solid #EBE0D0;">
          <div style="font-family:'Georgia',serif;font-size:14px;color:#8B8175;font-style:italic;margin-bottom:4px;">Breathe easy,</div>
          <div style="font-family:'Georgia',serif;font-size:20px;color:#2C2722;font-style:italic;">— Mary</div>
          <div style="font-size:12px;color:#B6AC9F;margin-top:12px;letter-spacing:0.1em;text-transform:uppercase;">Manifest with Mary · Tropical Refuge</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendSessionSummary({
  userId,
  chatId,
  userEmail,
  messages,
}: {
  userId: string;
  chatId: string;
  userEmail: string;
  messages: UIMessage[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !userEmail) return;
  if (messages.length < 6) return; // only send for real sessions (3+ turns each side)

  const transcript = messages
    .slice(-12) // last 12 messages for context
    .map((m) => `${m.role === 'user' ? 'Woman' : 'Coach Mary'}: ${messageToText(m)}`)
    .join('\n\n');

  let summary: {
    insights: string[];
    affirmation: string[];
    practice: string;
    identityWord: string;
  };

  try {
    const { text } = await generateText({
      model: openai(BRAND.chatModel),
      system: EXTRACT_SYSTEM,
      prompt: `Session transcript:\n\n${transcript}\n\nExtract the session summary JSON.`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    summary = JSON.parse(cleaned);
  } catch (err) {
    console.error('[session-summary] extraction failed:', err);
    return;
  }

  const sessionDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = buildEmailHtml({
    insights: summary.insights ?? [],
    affirmation: summary.affirmation ?? [],
    practice: summary.practice ?? '',
    identityWord: summary.identityWord ?? '',
    sessionDate,
  });

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'Coach Mary <mary@marytomanifest.com>',
      to: userEmail,
      subject: `Your session with Coach Mary — ${sessionDate}`,
      html,
    });
    console.log(`[session-summary] sent to ${userEmail} chat=${chatId}`);
  } catch (err) {
    console.error('[session-summary] send failed:', err);
  }
}
