/**
 * /api/storage-delete-embed — delete objects from the R2 media bucket.
 *
 * Used to remove orphaned/test objects (DeleteObject is within the Object
 * Read & Write token's scope). Embed-key gated. Body: { keys: string[] }.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AwsClient } from 'aws4fetch';

export const dynamic = 'force-dynamic';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  if ((req.headers.get('x-embed-key') ?? '') !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { keys?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const accountId = env('R2_ACCOUNT_ID');
    const bucket = env('R2_BUCKET');
    const r2 = new AwsClient({
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      region: 'auto',
      service: 's3',
    });
    const results: Array<{ key: string; status: number }> = [];
    for (const raw of body.keys ?? []) {
      const path = String(raw).replace(/[^a-zA-Z0-9._-]/g, '');
      if (!path) continue;
      const res = await r2.fetch(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`, { method: 'DELETE' });
      results.push({ key: path, status: res.status });
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error('[storage-delete-embed] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
