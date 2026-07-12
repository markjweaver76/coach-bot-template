/**
 * Content-gap report → blog topic ideas.
 *
 * Reads the queries logged in `content_gaps` (topics members asked about that our
 * corpus barely covered) and clusters them into suggested blog posts, each mapped
 * to the Tropical Refuge blog's controlled category + tags. The output is a
 * ready-to-paste markdown block for `blog-agent/TOPIC-BACKLOG.md` in the
 * tropicalrefuge repo, which the blog agent draws from.
 *
 * Usage:
 *   bun run content-gaps                    # last 30 days, all channels
 *   bun run content-gaps --days=60
 *   bun run content-gaps --channel=embed    # web | embed | all
 *   bun run content-gaps --raw              # skip clustering, just list top queries
 *
 * Requires DATABASE_URL (+ OPENAI_API_KEY unless --raw).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { listContentGaps } from '../lib/content-gaps';

const argv = process.argv.slice(2);
const num = (flag: string, def: number) => {
  const a = argv.find((x) => x.startsWith(`--${flag}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const DAYS = num('days', 30);
const LIMIT = num('limit', 500);
const RAW = argv.includes('--raw');
const CHANNEL = argv.find((a) => a.startsWith('--channel='))?.split('=')[1] ?? 'all';

// Controlled taxonomy — mirrors tropicalrefuge AGENTS.md. Keep in sync.
const CATEGORIES = [
  'Skincare', 'Nutrition', 'Reiki & Energy', 'Recovery',
  'Longevity', 'Mental Wellness', 'Corporate Wellness',
] as const;
const TAGS = [
  'skincare', 'nutrition', 'reiki-energy', 'recovery', 'longevity',
  'mental-wellness', 'corporate-wellness', 'functional-wellness', 'gut-health',
  'stress', 'sleep', 'hormones', 'inflammation', 'blue-zones', 'nervous-system',
  'holistic-skincare',
];

async function main() {
  const gaps = await listContentGaps({ days: DAYS, limit: LIMIT, channel: CHANNEL });

  if (!gaps.length) {
    console.log(
      `No content gaps logged in the last ${DAYS} days (channel: ${CHANNEL}).\n` +
        `That means retrieval is covering what members ask — nothing to add yet.`,
    );
    process.exit(0);
  }

  // Frequency of exact-ish queries for the raw view / model context.
  const counts = new Map<string, { n: number; sim: number }>();
  for (const g of gaps) {
    const key = g.query.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = counts.get(key);
    counts.set(key, { n: (prev?.n ?? 0) + 1, sim: Math.min(prev?.sim ?? 1, g.topSimilarity) });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);

  console.log(`# Content gaps — last ${DAYS} days (channel: ${CHANNEL})`);
  console.log(`${gaps.length} weak-retrieval queries, ${ranked.length} distinct.\n`);

  if (RAW) {
    console.log('## Top under-served queries');
    ranked.slice(0, 40).forEach(([q, v]) =>
      console.log(`- (${v.n}×, best match ${v.sim.toFixed(2)}) ${q}`),
    );
    process.exit(0);
  }

  console.log('Clustering into blog topics…\n');

  const topicSchema = z.object({
    topics: z.array(
      z.object({
        title: z.string().describe('Proposed blog post working title'),
        category: z.enum(CATEGORIES),
        tags: z.array(z.enum(TAGS as [string, ...string[]])).min(1).max(3),
        rationale: z.string().describe('Why this is a gap worth filling, 1 sentence'),
        queryCount: z.number().describe('How many logged queries this topic covers'),
        exampleQueries: z.array(z.string()).max(4),
      }),
    ),
  });

  const queryList = ranked
    .map(([q, v]) => `- (${v.n}×, best match ${v.sim.toFixed(2)}) ${q}`)
    .join('\n');

  const { object } = await generateObject({
    model: openai('gpt-5.5'),
    schema: topicSchema,
    prompt: `You help plan a holistic wellness blog (Tropical Refuge — skincare, reiki, nutrition, recovery, longevity, mental wellness). Below are real questions members asked the coaching chatbot that our content did NOT cover well (weak retrieval match). Cluster them into a prioritized list of specific, publishable blog post topics that would close these gaps.

Rules:
- Merge near-duplicate questions into one topic. Prefer specific, buyer-intent titles over broad ones.
- Assign exactly one category and 1–3 tags from the controlled lists you're constrained to.
- Order topics by how many logged queries they address (most first).
- Ignore off-topic / nonsensical queries. Return at most 15 topics.

Under-served queries (with frequency and best retrieval score):
${queryList}`,
  });

  const topics = object.topics.sort((a, b) => b.queryCount - a.queryCount);

  // Emit a markdown block ready to paste into blog-agent/TOPIC-BACKLOG.md.
  const today = gaps[0]?.createdAt?.slice(0, 10) ?? '';
  console.log('────────────────────────────────────────────────────────');
  console.log('Copy the block below into tropicalrefuge/blog-agent/TOPIC-BACKLOG.md:\n');
  console.log(`### From coach-bot content gaps (report run — newest gap ${today})`);
  console.log(`_Source: \`bun run content-gaps --days=${DAYS} --channel=${CHANNEL}\` · ${gaps.length} queries_\n`);
  console.log('| Topic | Category | Tags | Gap size | Example questions |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const t of topics) {
    const examples = t.exampleQueries.map((e) => `"${e}"`).join('; ');
    console.log(
      `| ${t.title} | ${t.category} | ${t.tags.join(', ')} | ${t.queryCount} | ${examples} |`,
    );
  }
  console.log('────────────────────────────────────────────────────────');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
