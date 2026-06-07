/**
 * /api/storage-cors-embed — apply the CORS policy to the R2 media bucket.
 *
 * Browser uploads to R2 are cross-origin PUTs, so the bucket needs a CORS policy
 * allowing the app origins. We can't reach the Cloudflare dashboard from here, so
 * this sets it via R2's S3 API (PutBucketCors) using the server-side R2 creds.
 * Embed-key gated; safe to re-run (idempotent — replaces the bucket's CORS config).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AwsClient } from 'aws4fetch';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const CORS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://marytomanifest.com</AllowedOrigin>
    <AllowedOrigin>https://www.marytomanifest.com</AllowedOrigin>
    <AllowedOrigin>http://localhost:5173</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

export async function POST(req: NextRequest) {
  if ((req.headers.get('x-embed-key') ?? '') !== process.env.EMBED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}?cors`;
    const md5 = createHash('md5').update(CORS_XML, 'utf8').digest('base64');
    const res = await r2.fetch(url, {
      method: 'PUT',
      body: CORS_XML,
      headers: { 'Content-Type': 'application/xml', 'Content-MD5': md5 },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `PutBucketCors ${res.status}: ${text.slice(0, 300)}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, bucket });
  } catch (err) {
    console.error('[storage-cors-embed] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
