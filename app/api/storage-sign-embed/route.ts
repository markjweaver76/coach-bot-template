/**
 * /api/storage-sign-embed — mint a one-time signed upload URL for Studio media.
 *
 * The Manifest with Mary Studio uploads video/audio straight to Supabase Storage
 * (so large files never route through the small app server / its 1 GB disk). This
 * endpoint uses the service role to (a) ensure the public `takes` bucket exists and
 * (b) return a signed upload URL the browser PUTs the file to directly.
 *
 * Embed-key gated (same pattern as the other -embed routes). Service role stays here.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BUCKET = 'takes';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

let bucketEnsured = false;
async function ensureBucket(supabase: ReturnType<typeof admin>) {
  if (bucketEnsured) return;
  // Idempotent: create the public bucket; ignore "already exists".
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5368709120', // 5 GB ceiling (project-level limit may be lower)
  });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`bucket: ${error.message}`);
  }
  bucketEnsured = true;
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

  // Sanitize the path (id.ext) — defend against traversal / odd chars.
  const path = String(body.path ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!path || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const supabase = admin();
    await ensureBucket(supabase);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'sign failed' }, { status: 500 });
    }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    return NextResponse.json({
      uploadUrl: data.signedUrl,                 // browser PUTs the file here
      token: data.token,
      path: data.path,
      publicUrl: `${base}/storage/v1/object/public/${BUCKET}/${path}`,
    });
  } catch (err) {
    console.error('[storage-sign-embed] error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
