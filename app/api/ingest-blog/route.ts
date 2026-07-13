/**
 * /api/ingest-blog — run the blog ingest from inside the deployment, reusing the
 * app's OWN runtime env (DATABASE_URL, OPENAI_API_KEY). Useful when those values
 * are stored as write-only/"sensitive" platform secrets you can't copy out to a
 * CI runner.
 *
 * Auth (set at least one; the endpoint 401s if neither is configured):
 *   • INGEST_TOKEN — a value you choose. Call with ?token=… (or header
 *     `x-ingest-token` / `Authorization: Bearer …`). Use this to trigger manually.
 *   • CRON_SECRET  — Vercel injects `Authorization: Bearer $CRON_SECRET` on Cron
 *     requests, so the weekly Cron in vercel.json authenticates automatically.
 *
 * Query params:
 *   source=tropical-refuge|eminence   one source (default: all)
 *   max=N                             cap posts per source (default: 25 — keeps a
 *                                     single invocation under the function timeout)
 *   dry=1                             discover only, don't embed/write
 *
 * Examples:
 *   GET /api/ingest-blog?token=YOURTOKEN                     → all sources (max 25 each)
 *   GET /api/ingest-blog?token=YOURTOKEN&source=eminence&max=80
 */
import { ingestSources, findSource } from '@/lib/blog-ingest';

// Allow a long run (Vercel caps to the plan's limit; Hobby=60s, Pro up to 300s).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DEFAULT_MAX = 25;

function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const provided =
    url.searchParams.get('token') ??
    req.headers.get('x-ingest-token') ??
    bearer;

  const ingestToken = process.env.INGEST_TOKEN;
  const cronSecret = process.env.CRON_SECRET;

  if (!ingestToken && !cronSecret) return false; // never run wide open
  if (ingestToken && provided && provided === ingestToken) return true;
  if (cronSecret && bearer && bearer === cronSecret) return true; // Vercel Cron
  return false;
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const sourceParam = url.searchParams.get('source') ?? undefined;
  const dryRun = ['1', 'true', 'yes'].includes(
    (url.searchParams.get('dry') ?? '').toLowerCase(),
  );
  const maxRaw = Number(url.searchParams.get('max'));
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : DEFAULT_MAX;

  if (sourceParam && !findSource(sourceParam)) {
    return Response.json(
      { ok: false, error: `Unknown source "${sourceParam}"` },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const results = await ingestSources(sourceParam ? [sourceParam] : undefined, {
      max,
      dryRun,
    });
    return Response.json({
      ok: true,
      dryRun,
      max,
      tookMs: Date.now() - startedAt,
      results: results.map((r) => ({
        key: r.key,
        label: r.label,
        discovered: r.discovered,
        posts: r.posts,
        chunks: r.chunks,
      })),
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message, tookMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

// POST behaves identically (handy for cron/webhook callers that prefer POST).
export async function POST(req: Request) {
  return handle(req);
}
