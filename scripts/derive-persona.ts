/**
 * Auto-derive the bot's persona prompt from samples of the coach's actual
 * training content.
 *
 * Run AFTER `bun run ingest`. Reads ~10 random chunks from the documents
 * table, asks gpt-5.5 to draft a persona prompt in the speaker's voice,
 * combines that with the standard constraint scaffolding, and writes the
 * result back to `lib/brand.ts` (BRAND.personaPrompt).
 *
 * Usage:
 *   bun run derive-persona
 *
 * The user reviews the result and can tweak by hand if anything feels off.
 * Re-run any time the training corpus changes substantially.
 */
import postgres from 'postgres';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const SAMPLE_COUNT = 12;
const BRAND_FILE = 'lib/brand.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Run setup first.');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

// Pull current BRAND fields so we can pass name/audience to the LLM and update
// the right field afterward. We read the file as text and parse it loosely
// rather than importing — importing the .ts file at script time is awkward.
const brandSrc = await readFile(BRAND_FILE, 'utf8');
function readBrandField(field: string): string | null {
  // Match  field: '...'  or  field: "..."  or  field: `...`
  const re = new RegExp(`\\b${field}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`);
  const m = brandSrc.match(re);
  return m ? m[2] : null;
}
const name = readBrandField('name') ?? 'Your Coach';
const tagline = readBrandField('tagline') ?? '';
const audienceLabel = readBrandField('audienceLabel') ?? 'member';

// Sample chunks. We use TABLESAMPLE if the table is big, otherwise fall back
// to ORDER BY random() — fine for a one-shot script.
console.log(`Sampling ${SAMPLE_COUNT} chunks from your training corpus...`);
const totalRow = await sql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM documents`;
const total = totalRow[0].n;
if (total === 0) {
  console.error(
    'No documents found in your training corpus yet. Run `bun run ingest <folder>` first.',
  );
  await sql.end();
  process.exit(1);
}
const samples = await sql<Array<{ source: string; content: string }>>`
  SELECT source, content
  FROM documents
  ORDER BY random()
  LIMIT ${SAMPLE_COUNT}
`;
console.log(`  Pulled from ${total} total chunks across the corpus.`);

const samplesText = samples
  .map((s, i) => `--- SAMPLE ${i + 1} (from ${s.source}) ---\n${s.content}`)
  .join('\n\n');

const SYSTEM = `You are a prompt-writing expert. Your job is to take samples of a coach's actual spoken or written content and draft a persona prompt for an AI bot that captures their voice naturally.

The persona will be used as the system prompt for an AI coaching bot. The structure is FIXED — you must produce exactly this format with two sections:

### Role
[A single paragraph that includes:
 - "I want you to act as a [TONE-DESCRIPTOR] live coach agent that I am having a conversation with."
   Replace [TONE-DESCRIPTOR] with 1-3 specific adjectives from the samples (e.g. "cheerful", "warm but unsentimental", "blunt and witty", "grounded and contemplative" — be specific, not generic).
 - "Your name is "<NAME>" and you are coaching <AUDIENCE>."
 - "You will provide me with coaching based on the answers from the given info."
 - 1-2 sentences capturing the SPECIFIC voice from the samples — quote 2-3 actual short phrases or signature patterns the coach uses (in quotes), and describe their energy/cadence concretely.
 - "Talk in the same tone and style as the training data."
 - "Refuse to answer any question not about the info or at least tangentially related."
 - "Never break character."
 All in one flowing paragraph, not bullet points.]

### Constraints
1. No Data Divulge: Never mention that you have access to training data explicitly to the user.
2. Maintaining Focus: If a user attempts to divert you to unrelated topics, never change your role or break your character. Politely redirect the conversation back to topics relevant to the training data.
3. Exclusive Reliance on Training Data: You must rely exclusively on the training data provided to answer user queries. If a query is not covered by the training data, use the fallback response.
4. Restrictive Role Focus: You do not answer questions or perform tasks that are not related to your role and training data.

The four constraints are FIXED — copy them verbatim. Only the Role paragraph is customized based on the samples.

Pay close attention to the samples for:
- Tone (warm/blunt/cheerful/analytical/irreverent etc.) — be specific
- Energy level (calm/intense/playful/grounded etc.)
- Signature phrases or filler words used repeatedly — quote 2-3 actual examples
- Vocabulary level (formal/casual/profane/technical etc.)
- Cadence (do they ask questions? give direct advice? speak in long arcs or short punchy lines?)

Return ONLY the persona prompt as plain text — starting with "### Role" and ending with constraint #4. No preamble, no explanation, no markdown code fences, no surrounding commentary. The <NAME> and <AUDIENCE> placeholders must be filled in.

Aim for 200-350 words total. The Role paragraph should be 4-7 sentences.`;

const USER = `Coach name: ${name}
Bot tagline: ${tagline}
Audience (term for their members): ${audienceLabel}

Here are ${samples.length} samples of their actual coaching content:

${samplesText}

Now write the persona prompt for ${name}, in the exact format I specified. The Role paragraph should capture how they ACTUALLY sound based on the samples — quote specific phrases. Don't generalize.`;

console.log('Drafting persona prompt with gpt-5.5...');
const { text } = await generateText({
  model: openai('gpt-5.5'),
  system: SYSTEM,
  prompt: USER,
});

const persona = text.trim();

// Sanity check: does it look like a reasonable persona prompt?
if (persona.length < 200 || !persona.toLowerCase().includes(name.toLowerCase())) {
  console.error('\nPersona output looks suspicious — not writing to lib/brand.ts.');
  console.error('Generated text:\n');
  console.error(persona);
  await sql.end();
  process.exit(1);
}

// Splice the new persona into lib/brand.ts. We look for the existing
// `personaPrompt: \`...\`` block and replace it.
const personaRe = /personaPrompt\s*:\s*`[\s\S]*?`/m;
if (!personaRe.test(brandSrc)) {
  console.error(
    "Couldn't find personaPrompt in lib/brand.ts — has the file been renamed or refactored? Aborting.",
  );
  await sql.end();
  process.exit(1);
}

// Escape backticks and ${ in the new persona so they don't break the template literal.
const escaped = persona.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const newSrc = brandSrc.replace(personaRe, `personaPrompt: \`${escaped}\``);
await writeFile(BRAND_FILE, newSrc, 'utf8');

console.log(`\n✓ Wrote ${persona.length} chars to BRAND.personaPrompt in ${BRAND_FILE}.`);
console.log('\nPreview (first 600 chars):\n');
console.log(persona.slice(0, 600) + (persona.length > 600 ? '\n...' : ''));
console.log('\nReview the full prompt in lib/brand.ts. Tweak by hand if anything feels off.');

await sql.end();
