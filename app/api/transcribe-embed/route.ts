/**
 * /api/transcribe-embed — server-to-server transcription for embedded integrations
 * (the Manifest with Mary Studio sends an extracted audio track here).
 *
 * Auth: `x-embed-key` header must match EMBED_SECRET.
 * Request:  multipart/form-data with `file` (audio, < 25 MB).
 * Response: { vtt: string, text: string }  — WebVTT captions + plain transcript.
 */
export const maxDuration = 120;

type Segment = { start: number; end: number; text: string };

function fmtTs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${sec.toFixed(3).padStart(6, '0')}`
  );
}

function buildVtt(segments: Segment[]): string {
  let out = 'WEBVTT\n\n';
  segments.forEach((s, i) => {
    out += `${i + 1}\n${fmtTs(s.start)} --> ${fmtTs(s.end)}\n${(s.text || '').trim()}\n\n`;
  });
  return out;
}

export async function POST(req: Request) {
  const embedKey = req.headers.get('x-embed-key');
  const secret = process.env.EMBED_SECRET;
  if (!secret || embedKey !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return Response.json({ error: 'No audio file provided' }, { status: 400 });
  }

  const oai = new FormData();
  oai.append('file', file, 'audio.mp3');
  oai.append('model', 'whisper-1');
  oai.append('response_format', 'verbose_json');
  oai.append('timestamp_granularities[]', 'segment');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: oai,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[transcribe-embed] OpenAI error', res.status, detail.slice(0, 200));
    return Response.json({ error: 'Transcription failed' }, { status: 502 });
  }

  const data = (await res.json()) as { text?: string; segments?: Segment[] };
  const segments = data.segments || [];
  return Response.json({ vtt: buildVtt(segments), text: (data.text || '').trim() });
}
