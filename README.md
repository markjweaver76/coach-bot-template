# Coaching Bot Template

A reusable, brandable AI coaching chatbot. Each instance is a standalone Next.js app with auth, retrieval over your training material, persistent per-user memory, and image/PDF/DOCX attachments. Deploy to Vercel.

This is the codebase that powers **Shosh A.I.** for The Vortex. To stand up your own version (different name, different persona, different training docs), see "Setup" below.

## Stack

- **Next.js 15** App Router
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`) for streaming + vision
- **Supabase** for Postgres, auth, and (eventually) file storage. RLS enforced on every table.
- **pgvector** for retrieval over training docs and per-user memory
- **OpenAI** GPT-5.5 (chat) + `text-embedding-3-small` (embeddings)
- **Vercel** for hosting

## Setup (with the Claude Code skill — recommended)

If you have Claude Code installed, the easiest path is:

```bash
git clone <this-repo-url> my-bot
cd my-bot
claude     # then say: "set up my coaching bot"
```

The `coach-bot-setup` skill will walk you through everything — Supabase + OpenAI + Vercel signup, key configuration, persona writing, training upload, deploy. ~30 minutes start to finish.

## Setup (manual)

If you'd rather do it by hand:

### 1. Get accounts and keys
- **Supabase** — sign up at supabase.com, create a new project, copy the URL + anon key + database connection string (transaction pooler, port 6543) + service role key
- **OpenAI** — generate an API key at platform.openai.com
- **Vercel** — sign up at vercel.com (only needed at deploy time)

### 2. Install dependencies
```bash
bun install   # or pnpm/npm install
```

### 3. Configure
Edit `lib/brand.ts` with your bot's name, tagline, persona prompt, dashboard URL, accent color, etc. This is the **only** code file you need to touch to rebrand.

Drop your logo at `public/logo.webp` and update `BRAND.logoSrc` accordingly.

### 4. Environment
Copy `.env.example` → `.env.local` and fill in:
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-X-<region>.pooler.supabase.com:6543/postgres
OPENAI_API_KEY=sk-proj-...
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

### 5. Initialize the database
Run the setup once against your Supabase project (creates tables, enables pgvector, sets up RLS policies, creates the `match_documents` RPC):

```bash
bun run db:init
```

### 6. Ingest your training content
```bash
bun run ingest ./path/to/your/training-docs
```

Supported formats: `.txt`, `.md`, `.pdf`, `.docx`, `.vtt`. Use `--max-depth=1` to skip subfolders.

### 7. Run locally
```bash
bun run dev
```

Open http://localhost:3000, sign up, and you're chatting with your bot.

### 8. Deploy
```bash
vercel link
vercel deploy --prod
```

Then in Vercel dashboard → Settings → Environment Variables, add the same keys you put in `.env.local`. And in Supabase → Authentication → URL Configuration, add your Vercel domain as the Site URL.

## How it works

```
User message
  ↓
[middleware] auth check via Supabase session cookie
  ↓
[route] embed last user msg → search RAG corpus + user memory
  ↓
[route] build system prompt (persona + retrieved chunks + remembered facts)
  ↓
[route] streamText to gpt-5.5 with attachments inlined
  ↓
[stream to client]   +   [onFinish]
                            ├── saveChat (persist messages)
                            └── extractAndStoreFacts (durable user memory)
```

## Customizing

Most clients only edit two things:

- **`lib/brand.ts`** — name, tagline, logo, persona prompt, accent color, dashboard URL. Single source of truth for everything user-facing.
- **`./training-docs/`** (or wherever) — the corpus your bot searches. Re-run `bun run ingest` after any change.

The persona is just prose — iterate on it freely. Changes take effect on the next message; no rebuild needed in dev.

## Architecture notes

- **Per-user memory is auto-extracted.** After each turn, an LLM pass pulls 0–8 durable facts about the user from the conversation and saves them with embeddings. Future turns retrieve the most relevant facts for the current question. Dedup is by cosine similarity (>0.88 = duplicate, skipped).
- **RLS is on for every table.** Even if your application code has a bug, Postgres won't return another user's data.
- **Attachments aren't persistently stored.** Images are sent to GPT-5.5 vision per turn; PDFs/DOCX are extracted to text at request time. The original file isn't kept anywhere. (If you want persistent uploads → personal corpus, that's a future enhancement using Vercel Blob.)
- **The training corpus is shared across all users in one project.** If you need per-user training, you'll need to add a `user_id` column to `documents` and adjust retrieval.

## Cost expectations

For a coaching app at moderate traffic:
- Supabase free tier (500 MB DB, 50k MAU) covers early launch indefinitely
- Vercel free Hobby tier covers a coaching app's traffic
- OpenAI: ~$0.30 per active user per month at gpt-5.5 prices (chat ~$0.005/turn, memory extraction ~$0.001/turn)

Your OpenAI bill scales with actual usage. The infra bills don't move until you outgrow the free tiers.
