/**
 * Walks a directory, reads .md / .txt / .pdf, chunks the text, embeds the
 * chunks, and inserts them into the `documents` table. Re-runnable: dedupes
 * by (source, content) before insert.
 *
 * Usage: pnpm ingest ./path/to/training-content
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import postgres from 'postgres';
import { config } from 'dotenv';
config({ path: '.env.local' });
config(); // also load .env if it exists
import { embedBatch } from '../lib/embed';

const args = process.argv.slice(2);
const maxDepthArg = args.find((a) => a.startsWith('--max-depth'));
const MAX_DEPTH = maxDepthArg
  ? Number(maxDepthArg.split('=')[1] ?? args[args.indexOf(maxDepthArg) + 1])
  : Infinity;
const TARGET = args.find((a) => !a.startsWith('--') && a !== String(MAX_DEPTH));
if (!TARGET) {
  console.error('Usage: bun run ingest [--max-depth=N] <directory>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Did you create .env.local?');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200;
const BATCH_SIZE = 50;
const TEXT_EXT = new Set(['.md', '.txt', '.markdown']);
const PDF_EXT = '.pdf';
const DOCX_EXT = '.docx';
const VTT_EXT = '.vtt';

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) {
      if (depth + 1 < MAX_DEPTH) yield* walk(p, depth + 1);
    } else yield p;
  }
}

function stripVtt(raw: string): string {
  // Remove WEBVTT header, timestamps, and cue indices — keep only the spoken lines.
  return raw
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t === 'WEBVTT') return false;
      if (/^\d+$/.test(t)) return false;                                // cue index
      if (/-->/.test(t)) return false;                                  // timestamp
      if (/^NOTE\b/.test(t) || /^STYLE\b/.test(t)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readFileText(file: string): Promise<string | null> {
  const ext = extname(file).toLowerCase();
  if (TEXT_EXT.has(ext)) return await readFile(file, 'utf8');
  if (ext === VTT_EXT) return stripVtt(await readFile(file, 'utf8'));
  if (ext === PDF_EXT) {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = await readFile(file);
    const { text } = await pdfParse(buf);
    return text;
  }
  if (ext === DOCX_EXT) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path: file });
    return value;
  }
  return null;
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const end = Math.min(i + CHUNK_CHARS, n);
    out.push(text.slice(i, end).trim());
    if (end === n) break;
    i = end - OVERLAP_CHARS;
  }
  return out.filter((c) => c.length > 50);
}

async function insertBatch(
  rows: Array<{ source: string; content: string; embedding: number[] }>,
) {
  for (const r of rows) {
    const exists = (await sql`
      SELECT 1 FROM documents WHERE source = ${r.source} AND content = ${r.content} LIMIT 1
    `) as unknown[];
    if (exists.length) continue;
    const vec = '[' + r.embedding.join(',') + ']';
    await sql`
      INSERT INTO documents (source, content, embedding)
      VALUES (${r.source}, ${r.content}, ${vec}::vector)
    `;
  }
}

async function main() {
  const root = resolve(TARGET!);
  console.log(`Ingesting from ${root}`);
  const pending: Array<{ source: string; content: string }> = [];
  let totalFiles = 0;

  for await (const file of walk(root)) {
    const text = await readFileText(file);
    if (!text) continue;
    totalFiles++;
    const source = relative(process.cwd(), file);
    for (const c of chunk(text)) pending.push({ source, content: c });
  }
  console.log(`Read ${totalFiles} files, produced ${pending.length} chunks.`);

  let processed = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((b) => b.content));
    const rows = batch.map((b, j) => ({ ...b, embedding: embeddings[j] }));
    await insertBatch(rows);
    processed += batch.length;
    console.log(`  [${processed}/${pending.length}] embedded + inserted`);
  }

  console.log(`Done. Ingested ${pending.length} chunks from ${totalFiles} files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
