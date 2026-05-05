/**
 * Transcribe audio/video files in a folder using AssemblyAI.
 *
 * Usage:
 *   bun run transcribe ./path/to/videos
 *   bun run transcribe --max-depth=1 ./path/to/videos
 *
 * For each .mp4/.mov/.m4a/.mp3/.wav/.webm/.mkv/.aac/.flac/.ogg file, this
 * uploads to AssemblyAI, waits for the transcript, and writes the result as
 * `<filename>.transcript.txt` in the same directory.
 *
 * Idempotent: skips any file that already has a `.transcript.txt` sibling.
 *
 * After running, your training folder has plain-text transcripts alongside the
 * source media. Run `bun run ingest <folder>` next to load them into the RAG
 * corpus (text files are picked up automatically; the source video is ignored).
 *
 * Cost: ~$0.65 per hour of audio at AssemblyAI's universal model. Free tier
 * gives you 5 hours/month for testing.
 */
import { AssemblyAI } from 'assemblyai';
import { readdir, stat, access, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const args = process.argv.slice(2);
const maxDepthArg = args.find((a) => a.startsWith('--max-depth'));
const MAX_DEPTH = maxDepthArg
  ? Number(maxDepthArg.split('=')[1] ?? args[args.indexOf(maxDepthArg) + 1])
  : Infinity;
const TARGET = args.find((a) => !a.startsWith('--') && a !== String(MAX_DEPTH));

if (!TARGET) {
  console.error('Usage: bun run transcribe [--max-depth=N] <directory>');
  process.exit(1);
}
if (!process.env.ASSEMBLYAI_API_KEY) {
  console.error(
    'ASSEMBLYAI_API_KEY not set. Sign up at https://www.assemblyai.com and add the key to .env.local.',
  );
  process.exit(1);
}

const MEDIA_EXTS = new Set([
  '.mp4',
  '.mov',
  '.m4a',
  '.mp3',
  '.wav',
  '.webm',
  '.mkv',
  '.aac',
  '.flac',
  '.ogg',
  '.m4v',
  '.avi',
]);

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    if (entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) {
      if (depth + 1 < MAX_DEPTH) yield* walk(p, depth + 1);
    } else yield p;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function transcribeOne(file: string): Promise<{ words: number; chars: number }> {
  const transcript = await client.transcripts.transcribe({
    audio: file,
    // speaker_labels makes coaching calls much more useful — the model can see
    // who said what when there are multiple voices on the line.
    speaker_labels: true,
  });

  if (transcript.status === 'error') {
    throw new Error(transcript.error ?? 'AssemblyAI returned an error');
  }
  if (!transcript.text) {
    throw new Error('AssemblyAI returned no text');
  }

  // If we got speaker labels, format as a readable transcript with speaker turns.
  // Otherwise just dump the text.
  let body: string;
  if (transcript.utterances && transcript.utterances.length > 0) {
    body = transcript.utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n\n');
  } else {
    body = transcript.text;
  }

  const outPath = `${file}.transcript.txt`;
  await writeFile(outPath, body, 'utf8');

  return { words: body.split(/\s+/).length, chars: body.length };
}

async function main() {
  const root = resolve(TARGET!);
  console.log(`Scanning ${root} for audio/video files...`);

  const queue: string[] = [];
  for await (const file of walk(root)) {
    const ext = extname(file).toLowerCase();
    if (!MEDIA_EXTS.has(ext)) continue;
    if (await fileExists(`${file}.transcript.txt`)) continue;
    queue.push(file);
  }

  if (queue.length === 0) {
    console.log('Nothing to do — every media file already has a .transcript.txt sibling.');
    return;
  }

  console.log(`Queued ${queue.length} files. Estimated cost at $0.65/hour audio.\n`);

  let totalWords = 0;
  let done = 0;
  let failed = 0;
  for (const file of queue) {
    done++;
    const rel = file.replace(root + '/', '');
    process.stdout.write(`  [${done}/${queue.length}] ${rel} ... `);
    try {
      const { words } = await transcribeOne(file);
      totalWords += words;
      console.log(`${words.toLocaleString()} words`);
    } catch (err) {
      failed++;
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\nDone. ${done - failed}/${queue.length} transcribed (${totalWords.toLocaleString()} words total).`,
  );
  if (failed > 0) console.log(`${failed} failed — see errors above.`);
  console.log(`Next: run \`bun run ingest ${TARGET}\` to load these into your RAG corpus.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
