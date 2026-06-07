/**
 * /api/storage-sign-embed — mint a presigned upload URL for Studio media (Cloudflare R2).
 *
 * The Manifest with Mary Studio uploads video/audio straight to R2 (S3-compatible),
 * so large files never route through the small app server / its 1 GB disk. We sign a
 * one-time PUT URL with the R2 credentials (SigV4 via aws4fetch); the browser PUTs the
 * file directly, then the public bucket URL serves it (free egress on R2).
 *
 * Embed-key gated (same pattern as the other -embed routes). R2 secrets stay here.
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *               R2_PUBLIC_BASE (e.g. https://pub-xxxx.r2.dev — no trailing slash).
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
  const key = req.headers.get('x-embed-key') ?? '';
  if (key !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Sanitize the object key (id.ext) — defend against traversal / odd chars.
  const path = String(body.path ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!path || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const accountId = env('R2_ACCOUNT_ID');
    const bucket = env('R2_BUCKET');
    const publicBase = env('R2_PUBLIC_BASE').replace(/\/+$/, '');

    const r2 = new AwsClient({
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      region: 'auto',
      service: 's3',
    });

    // Presign a PUT to the object (query-auth so the browser needs no signing).
    const target = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`);
    target.searchParams.set('X-Amz-Expires', '3600'); // 1-hour window to start the upload
    const signed = await r2.sign(target.toString(), {
      method: 'PUT',
      aws: { signQuery: true },
    });

    return NextResponse.json({
      uploadUrl: signed.url,            // browser PUTs the raw file here
      publicUrl: `${publicBase}/${path}`,
      path,
    });
  } catch (err) {
    console.error('[storage-sign-embed] error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // Surface missing-config clearly so setup problems are obvious.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
