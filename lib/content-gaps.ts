/**
 * CONTENT GAPS — a feedback loop for the blog.
 *
 * When a member asks about something the RAG corpus barely covers (the best
 * retrieval match is weak), that's a signal we're missing content on the topic.
 * We log the query so it can be turned into blog topic ideas.
 *
 * `scripts/content-gaps.ts` reads this table and clusters the queries into
 * suggested posts (mapped to the blog's controlled categories/tags) that can be
 * added to the blog agent's topic backlog.
 *
 * The table is created lazily (same pattern as user_intention) so existing
 * deployments don't need a migration; fresh installs get it from init-supabase.
 */
import { getSql } from './db';

/**
 * Best-match cosine similarity at or above this is considered "covered"; below it
 * we treat the query as a content gap. (searchDocs returns 1 - cosine_distance,
 * so higher = more similar. Solid on-topic hits land ~0.45+.)
 */
export const GAP_SIMILARITY_THRESHOLD = 0.35;

let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS content_gaps (
      id BIGSERIAL PRIMARY KEY,
      query TEXT NOT NULL,
      top_similarity REAL NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'web',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS content_gaps_created_at_idx ON content_gaps (created_at DESC)`;
  _tableReady = true;
}

// Greetings / smalltalk that shouldn't count as topic gaps even if retrieval is weak.
const SMALLTALK_RE =
  /^\s*(hi|hey+|hello|yo|sup|thanks?|thank you|ty|ok(ay)?|kk|yes|no|nope|yep|good\s?(morning|afternoon|evening|night)|how are you|what'?s up|bye|good\s?bye)\b/i;

function isTopicalQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 12) return false; // too short to be a real topic
  if (q.split(/\s+/).length < 3) return false; // needs a bit of substance
  if (SMALLTALK_RE.test(q) && q.length < 40) return false;
  if (!/[a-z]{3,}/i.test(q)) return false; // must contain real words
  return true;
}

/**
 * Record a content gap if the query is a substantive topic AND retrieval was
 * weak. Best-effort: never throws (callers fire-and-forget). Long queries are
 * trimmed so the table stays readable.
 */
export async function maybeRecordContentGap({
  query,
  topSimilarity,
  channel,
}: {
  query: string;
  topSimilarity: number;
  channel: 'web' | 'embed' | string;
}): Promise<void> {
  try {
    if (topSimilarity >= GAP_SIMILARITY_THRESHOLD) return;
    if (!isTopicalQuery(query)) return;
    await ensureTable();
    const sql = getSql();
    const trimmed = query.trim().replace(/\s+/g, ' ').slice(0, 500);
    await sql`
      INSERT INTO content_gaps (query, top_similarity, channel)
      VALUES (${trimmed}, ${topSimilarity}, ${channel})
    `;
  } catch (err) {
    // Non-fatal — a missing gap log must never break a chat turn.
    console.error('[content-gaps] record failed', err);
  }
}

export type ContentGapRow = {
  query: string;
  topSimilarity: number;
  channel: string;
  createdAt: string;
};

/** Read recent gaps for the report script. */
export async function listContentGaps({
  days = 30,
  limit = 500,
  channel,
}: {
  days?: number;
  limit?: number;
  channel?: string;
} = {}): Promise<ContentGapRow[]> {
  await ensureTable();
  const sql = getSql();
  const rows = channel && channel !== 'all'
    ? await sql<Array<{ query: string; top_similarity: number; channel: string; created_at: Date }>>`
        SELECT query, top_similarity, channel, created_at
        FROM content_gaps
        WHERE created_at > now() - (${days} || ' days')::interval AND channel = ${channel}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql<Array<{ query: string; top_similarity: number; channel: string; created_at: Date }>>`
        SELECT query, top_similarity, channel, created_at
        FROM content_gaps
        WHERE created_at > now() - (${days} || ' days')::interval
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map((r) => ({
    query: r.query,
    topSimilarity: r.top_similarity,
    channel: r.channel,
    createdAt: r.created_at.toISOString(),
  }));
}
