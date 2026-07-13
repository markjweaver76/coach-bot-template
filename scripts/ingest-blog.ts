/**
 * CLI wrapper around the shared blog-ingest core (`lib/blog-ingest.ts`).
 * Ingests external blog content (see `lib/blog-sources.ts`) into the `documents`
 * RAG table so the bot can surface it in chat as education and guidance.
 *
 * Usage:
 *   bun run ingest-blog                 # all sources
 *   bun run ingest-blog eminence        # one source by key
 *   bun run ingest-blog --max=20        # cap posts per source
 *   bun run ingest-blog --dry           # discover + print, don't embed/write
 *
 * Requires DATABASE_URL and OPENAI_API_KEY in .env.local (or .env).
 *
 * (The same ingest also runs in-app via /api/ingest-blog, which reuses the
 * deployment's own env — handy when your platform hides those secrets.)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { BLOG_SOURCES } from '../lib/blog-sources';
import { ingestSource } from '../lib/blog-ingest';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const maxArg = argv.find((a) => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.split('=')[1]) : undefined;
const keys = argv.filter((a) => !a.startsWith('--'));

if (!DRY && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Did you create .env.local?');
  process.exit(1);
}

async function main() {
  const sources = keys.length
    ? BLOG_SOURCES.filter((s) => keys.includes(s.key))
    : BLOG_SOURCES;
  if (!sources.length) {
    console.error(`No matching sources. Available: ${BLOG_SOURCES.map((s) => s.key).join(', ')}`);
    process.exit(1);
  }

  for (const src of sources) {
    console.log(`\n=== ${src.label} (${src.key}) ===`);
    try {
      const result = await ingestSource(src, {
        max: MAX,
        dryRun: DRY,
        onPost: (p) =>
          console.log(DRY ? `   • ${p.title}  —  ${p.url}` : `  [+${p.chunks}] ${p.title}`),
      });
      console.log(
        DRY
          ? `  discovered ${result.discovered} posts`
          : `  done — ${result.posts} posts, ${result.chunks} chunks`,
      );
    } catch (err) {
      console.error(`  ! failed: ${(err as Error).message}`);
    }
  }

  console.log('\nBlog ingest complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
