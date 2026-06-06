/**
 * /api/voice-embed — real-time voice transcription for embedded integrations.
 *
 * Auth: `x-embed-key` header must match EMBED_SECRET env var.
 * Request: multipart/form-data with an `audio` file (webm, mp4, mp3, wav, etc.)
 * Response: { text: string } — the Whisper transcription.
 *
 * Designed for the Manifest with Mary SLP voice-mode flow:
 *   Browser mic → SLP Express /api/voice → here → OpenAI Whisper → text
 */

export const maxDuration = 30;

export async function POST(req: Request) {
  // — Auth —
  const embedKey = req.headers.get('x-embed-key');
  const secret = process.env.EMBED_SECRET;
  if (!secret || embedKey !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const formData = await req.formData();
  const audio = formData.get('audio') as File | null;
  if (!audio || audio.size === 0) {
    return Response.json({ error: 'audio file required' }, { status: 400 });
  }

  // Forward to OpenAI Whisper (synchronous, typically 1–3 s for short clips)
  const oaForm = new FormData();
  oaForm.append('file', audio, audio.name || 'voice.webm');
  oaForm.append('model', 'whisper-1');
  oaForm.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: oaForm,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('[voice-embed] OpenAI error', res.status, err.slice(0, 200));
    return Response.json({ error: 'transcription failed' }, { status: 502 });
  }

  const { text } = (await res.json()) as { text?: string };
  return Response.json({ text: text?.trim() ?? '' });
}
