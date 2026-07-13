/**
 * Shared blog-ingest core — used by both the CLI (`scripts/ingest-blog.ts`) and
 * the in-app endpoint (`app/api/ingest-blog/route.ts`).
 *
 * Fetches a blog source's posts (feed or crawl), chunks + embeds them, and
 * upserts them into the `documents` RAG table keyed on each post's PUBLIC URL.
 * Re-runnable: a post's existing rows (matched by source URL) are deleted and
 * re-inserted, so edits/removals on the source blog are reflected.
 */
import { embedBatch } from './embed';
import { getSql } from './db';
import {
  BLOG_SOURCES,
  type BlogSource,
  type CrawlSource,
  type FeedSource,
} from './blog-sources';

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200;
const MAX_CHUNKS_PER_POST = 8; // keep embedding cost bounded per post
const FETCH_DELAY_MS = 150; // be a polite crawler

export type Post = { url: string; title: string; body: string };
export type IngestResult = {
  key: string;
  label: string;
  discovered: number;
  posts: number;
  chunks: number;
  items: Array<{ title: string; url: string; chunks: number }>;
  dryRun: boolean;
};

// ── HTML helpers (dependency-free) ───────────────────────────────────────────
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function stripHtml(html: string): string {
  const noScript = html.replace(
    /<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );
  return decodeEntities(noScript.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n && out.length < MAX_CHUNKS_PER_POST) {
    const end = Math.min(i + CHUNK_CHARS, n);
    out.push(text.slice(i, end).trim());
    if (end === n) break;
    i = end - OVERLAP_CHARS;
  }
  return out.filter((c) => c.length > 50);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'coach-bot-blog-ingest/1.0 (+RAG education)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Feed sources (Atom/RSS with full body) ───────────────────────────────────
async function discoverFeed(src: FeedSource, max: number): Promise<Post[]> {
  const xml = await fetchText(src.feedUrl);
  const posts: Post[] = [];
  const blocks = xml.match(/<(entry|item)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = decodeEntities(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim(),
    );
    const url =
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() ??
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() ??
      '';
    const rawBody =
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ??
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ??
      '';
    const body = stripHtml(rawBody.replace(/<!\[CDATA\[|\]\]>/g, ''));
    if (url && title && body) posts.push({ url, title, body });
    if (posts.length >= max) break;
  }
  return posts;
}

// ── Crawl sources (walk category pages, extract article text) ─────────────────
function absolutize(origin: string, href: string): string | null {
  try {
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
function extractHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
}

async function discoverCrawl(src: CrawlSource, max: number): Promise<Post[]> {
  const seedHtml = await fetchText(src.seedUrl);
  const seedLinks = extractHrefs(seedHtml)
    .map((h) => absolutize(src.origin, h))
    .filter((u): u is string => !!u);

  const categories = [
    ...new Set(seedLinks.filter((u) => src.categoryPathRe.test(pathOf(u)))),
  ];

  const seen = new Set<string>();
  const postUrls: string[] = [];
  const addPost = (u: string) => {
    if (!seen.has(u) && src.postPathRe.test(pathOf(u))) {
      seen.add(u);
      postUrls.push(u);
    }
  };
  seedLinks.forEach(addPost);

  const MAX_PAGES = 8;
  for (const category of categories) {
    if (postUrls.length >= max) break;
    for (let page = 0; page < MAX_PAGES && postUrls.length < max; page++) {
      const pageUrl = src.pageUrl(category, page * src.pageSize);
      let html: string;
      try {
        html = await fetchText(pageUrl);
      } catch {
        break;
      }
      const before = postUrls.length;
      extractHrefs(html)
        .map((h) => absolutize(src.origin, h))
        .filter((u): u is string => !!u)
        .forEach(addPost);
      await sleep(FETCH_DELAY_MS);
      if (postUrls.length === before) break;
    }
  }

  const posts: Post[] = [];
  for (const url of postUrls.slice(0, max)) {
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      continue;
    }
    const title = stripHtml(src.titleRe.exec(html)?.[1] ?? '') || url;
    const start = src.bodyStartRe.exec(html)?.index ?? 0;
    const endMatch = src.bodyEndRe.exec(html);
    const end = endMatch && endMatch.index > start ? endMatch.index : html.length;
    const body = stripHtml(html.slice(start, end));
    if (body.length > 120) posts.push({ url, title, body });
    await sleep(FETCH_DELAY_MS);
  }
  return posts;
}

async function discover(src: BlogSource, max: number): Promise<Post[]> {
  return src.mode === 'feed'
    ? discoverFeed(src, max)
    : discoverCrawl(src, max);
}

// ── Persist ──────────────────────────────────────────────────────────────────
async function upsertPost(post: Post): Promise<number> {
  const header = `Title: ${post.title}\nSource: ${post.url}\n\n`;
  const chunks = chunk(post.body).map((c) => header + c);
  if (!chunks.length) return 0;
  const embeddings = await embedBatch(chunks);
  const sql = getSql();
  await sql`DELETE FROM documents WHERE source = ${post.url}`;
  for (let j = 0; j < chunks.length; j++) {
    const vec = '[' + embeddings[j].join(',') + ']';
    await sql`
      INSERT INTO documents (source, content, embedding)
      VALUES (${post.url}, ${chunks[j]}, ${vec}::vector)
    `;
  }
  return chunks.length;
}

/** Resolve a source config by key. */
export function findSource(key: string): BlogSource | undefined {
  return BLOG_SOURCES.find((s) => s.key === key);
}

/** Ingest a single source. `max` overrides the source's configured cap. */
export async function ingestSource(
  src: BlogSource,
  opts: {
    max?: number;
    dryRun?: boolean;
    onPost?: (p: { title: string; url: string; chunks: number }) => void;
  } = {},
): Promise<IngestResult> {
  const max = opts.max ?? src.maxPosts;
  const posts = await discover(src, max);
  const items: IngestResult['items'] = [];
  let chunks = 0;

  for (const post of posts) {
    const n = opts.dryRun ? 0 : await upsertPost(post);
    chunks += n;
    const item = { title: post.title, url: post.url, chunks: n };
    items.push(item);
    opts.onPost?.(item);
  }

  return {
    key: src.key,
    label: src.label,
    discovered: posts.length,
    posts: posts.length,
    chunks,
    items,
    dryRun: !!opts.dryRun,
  };
}

/**
 * Ingest several sources by key (default: all). `max` (if given) caps posts per
 * source. Sources run sequentially so callers can bound total work/time.
 */
export async function ingestSources(
  keys: string[] | undefined,
  opts: { max?: number; dryRun?: boolean } = {},
): Promise<IngestResult[]> {
  const sources = keys?.length
    ? BLOG_SOURCES.filter((s) => keys.includes(s.key))
    : BLOG_SOURCES;
  const results: IngestResult[] = [];
  for (const src of sources) {
    results.push(await ingestSource(src, opts));
  }
  return results;
}
