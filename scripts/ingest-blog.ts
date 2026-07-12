/**
 * Ingests external blog content (see `lib/blog-sources.ts`) into the `documents`
 * RAG table so the bot can surface it in chat as education and guidance. Each
 * post is stored with `source` set to its PUBLIC URL, which lets the system
 * prompt render it as linkable "Further Reading" (private training docs keep
 * file-path sources and stay unlinkable).
 *
 * Re-runnable: for every post it re-fetches, it deletes the post's existing rows
 * (matched by source URL) and re-inserts fresh chunks, so edits/removals on the
 * source blog are reflected without duplicating.
 *
 * Usage:
 *   bun run ingest-blog                 # all sources
 *   bun run ingest-blog eminence        # one source by key
 *   bun run ingest-blog --max=20        # cap posts per source (overrides config)
 *   bun run ingest-blog --dry           # discover + print, don't embed/write
 *
 * Requires DATABASE_URL and OPENAI_API_KEY in .env.local (or .env).
 */
import postgres from 'postgres';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { embedBatch } from '../lib/embed';
import {
  BLOG_SOURCES,
  type BlogSource,
  type CrawlSource,
  type FeedSource,
} from '../lib/blog-sources';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const maxArg = argv.find((a) => a.startsWith('--max='));
const MAX_OVERRIDE = maxArg ? Number(maxArg.split('=')[1]) : undefined;
const keys = argv.filter((a) => !a.startsWith('--'));

if (!DRY && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Did you create .env.local?');
  process.exit(1);
}
const sql = DRY ? null : postgres(process.env.DATABASE_URL!, { ssl: 'require' });

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200;
const MAX_CHUNKS_PER_POST = 8; // keep embedding cost bounded per post
const FETCH_DELAY_MS = 200; // be a polite crawler

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

type Post = { url: string; title: string; body: string };

// ── Feed sources (Atom/RSS with full body) ───────────────────────────────────
async function discoverFeed(src: FeedSource): Promise<Post[]> {
  const xml = await fetchText(src.feedUrl);
  const posts: Post[] = [];
  // Atom <entry> or RSS <item>
  const blocks = xml.match(/<(entry|item)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = decodeEntities(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim(),
    );
    const url =
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? // Atom
      block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? // RSS
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() ??
      '';
    const rawBody =
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ??
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ??
      '';
    const body = stripHtml(
      rawBody.replace(/<!\[CDATA\[|\]\]>/g, ''),
    );
    if (url && title && body) posts.push({ url, title, body });
    if (posts.length >= src.maxPosts) break;
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

  // Category index pages, e.g. /us/blog/skincare
  const categories = [
    ...new Set(seedLinks.filter((u) => src.categoryPathRe.test(pathOf(u)))),
  ];

  // Post URLs — start with any found on the landing page (newest-first),
  // preserving discovery order.
  const seen = new Set<string>();
  const postUrls: string[] = [];
  const addPost = (u: string) => {
    if (!seen.has(u) && src.postPathRe.test(pathOf(u))) {
      seen.add(u);
      postUrls.push(u);
    }
  };
  seedLinks.forEach(addPost);

  // Page through each category until it stops yielding new posts (or we hit max).
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
      if (postUrls.length === before) break; // no new posts on this page → done
    }
  }

  // Fetch + extract each post page.
  const posts: Post[] = [];
  for (const url of postUrls.slice(0, max)) {
    let html: string;
    try {
      html = await fetchText(url);
    } catch (err) {
      console.warn(`  ! skip ${url}: ${(err as Error).message}`);
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

async function discover(src: BlogSource): Promise<Post[]> {
  const max = MAX_OVERRIDE ?? src.maxPosts;
  return src.mode === 'feed'
    ? (await discoverFeed(src)).slice(0, max)
    : discoverCrawl(src, max);
}

// ── Persist ──────────────────────────────────────────────────────────────────
async function upsertPost(post: Post): Promise<number> {
  // A short header on every chunk keeps the title + URL retrievable and gives the
  // model the exact link to surface.
  const header = `Title: ${post.title}\nSource: ${post.url}\n\n`;
  const chunks = chunk(post.body).map((c) => header + c);
  if (!chunks.length) return 0;
  const embeddings = await embedBatch(chunks);
  await sql!`DELETE FROM documents WHERE source = ${post.url}`;
  for (let j = 0; j < chunks.length; j++) {
    const vec = '[' + embeddings[j].join(',') + ']';
    await sql!`
      INSERT INTO documents (source, content, embedding)
      VALUES (${post.url}, ${chunks[j]}, ${vec}::vector)
    `;
  }
  return chunks.length;
}

async function main() {
  const sources = keys.length
    ? BLOG_SOURCES.filter((s) => keys.includes(s.key))
    : BLOG_SOURCES;
  if (!sources.length) {
    console.error(
      `No matching sources. Available: ${BLOG_SOURCES.map((s) => s.key).join(', ')}`,
    );
    process.exit(1);
  }

  for (const src of sources) {
    console.log(`\n=== ${src.label} (${src.key}) ===`);
    let posts: Post[];
    try {
      posts = await discover(src);
    } catch (err) {
      console.error(`  ! discovery failed: ${(err as Error).message}`);
      continue;
    }
    console.log(`  discovered ${posts.length} posts`);

    if (DRY) {
      posts.forEach((p) => console.log(`   • ${p.title}  —  ${p.url}`));
      continue;
    }

    let totalChunks = 0;
    for (const post of posts) {
      try {
        const n = await upsertPost(post);
        totalChunks += n;
        console.log(`  [+${n}] ${post.title}`);
      } catch (err) {
        console.warn(`  ! failed ${post.url}: ${(err as Error).message}`);
      }
    }
    console.log(`  done — ${posts.length} posts, ${totalChunks} chunks`);
  }

  if (sql) await sql.end();
  console.log('\nBlog ingest complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
