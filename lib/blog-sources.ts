/**
 * BLOG SOURCES — external content the bot is allowed to cite and link in chat.
 *
 * This is the single source of truth shared by:
 *   • `scripts/ingest-blog.ts`  — pulls each source's posts into the `documents`
 *     table (RAG corpus), keyed on the post's public URL as its `source`.
 *   • `lib/system-prompt.ts`     — recognizes retrieved chunks whose `source` is
 *     one of these public URLs and renders them in a "Further Reading" block that
 *     the bot MAY link, as opposed to the private training corpus it must not
 *     reveal.
 *
 * Two discovery modes:
 *   • `feed`  — an RSS/Atom feed that already contains the full post body.
 *   • `crawl` — no feed, so we walk the blog's category pages, collect post URLs,
 *     and extract the article text from each page (bounded by `maxPosts`).
 *
 * To add a content source: append an entry here, then run `bun run ingest-blog`.
 */

export type FeedSource = {
  key: string;
  label: string;
  host: string;
  maxPosts: number;
  mode: 'feed';
  /** RSS/Atom feed URL. Entries must carry the full post body. */
  feedUrl: string;
};

export type CrawlSource = {
  key: string;
  label: string;
  host: string;
  maxPosts: number;
  mode: 'crawl';
  /** Blog landing page to start discovery from. */
  seedUrl: string;
  /** Scheme + host used to resolve relative links (e.g. https://example.com). */
  origin: string;
  /** Path of an individual post, e.g. /us/blog/skincare/some-post.html */
  postPathRe: RegExp;
  /** Path of a category index, e.g. /us/blog/skincare */
  categoryPathRe: RegExp;
  /** Builds a paginated category URL. `start` is the offset. */
  pageUrl: (categoryUrl: string, start: number) => string;
  /** Page size passed to `pageUrl` — also the pagination stride. */
  pageSize: number;
  /** Extracts the post title (capture group 1 = inner HTML). */
  titleRe: RegExp;
  /** Marks where the article body begins in the page HTML. */
  bodyStartRe: RegExp;
  /** Marks where the article body ends (author bio / related posts). */
  bodyEndRe: RegExp;
};

export type BlogSource = FeedSource | CrawlSource;

export const BLOG_SOURCES: BlogSource[] = [
  {
    key: 'tropical-refuge',
    label: 'Tropical Refuge Journal',
    host: 'tropicalrefuge.com',
    maxPosts: 100,
    mode: 'feed',
    feedUrl: 'https://www.tropicalrefuge.com/feed.xml',
  },
  {
    key: 'eminence',
    label: 'Eminence Organics Blog',
    host: 'eminenceorganics.com',
    maxPosts: 80,
    mode: 'crawl',
    seedUrl: 'https://eminenceorganics.com/us/blog.html',
    origin: 'https://eminenceorganics.com',
    postPathRe: /^\/us\/blog\/[a-z0-9-]+\/[a-z0-9-]+\.html$/i,
    categoryPathRe: /^\/us\/blog\/[a-z0-9-]+$/i,
    pageUrl: (categoryUrl, start) =>
      `${categoryUrl}?csortb1=blogUpdateDate&csortd1=2&start=${start}&sz=24`,
    pageSize: 24,
    titleRe: /<h1[^>]*b-blog-article-title[^>]*>([\s\S]*?)<\/h1>/i,
    bodyStartRe: /class="b-blog-article-title/i,
    bodyEndRe: /class="b-blog-article-author/i,
  },
];

/**
 * If `source` is a public URL from one of our configured blogs, return its
 * human label. Returns null for the private training corpus (file-path sources)
 * or any URL not on the allow-list — those must never be linked in chat.
 */
export function matchPublicSource(source: string): { label: string } | null {
  if (!/^https?:\/\//i.test(source)) return null;
  let host: string;
  try {
    host = new URL(source).hostname.toLowerCase();
  } catch {
    return null;
  }
  const s = BLOG_SOURCES.find(
    (b) => host === b.host || host.endsWith('.' + b.host),
  );
  return s ? { label: s.label } : null;
}
