/**
 * One-shot Supabase setup for a fresh project.
 *
 * Run once after creating your Supabase project + filling in DATABASE_URL in .env.local:
 *   bun run scripts/init-supabase.ts
 *
 * What it does:
 *   1. Enables the pgvector extension
 *   2. Creates the `chats`, `messages`, `documents`, `user_memory` tables
 *   3. Sets up Row Level Security policies (users can only see their own data)
 *   4. Creates the `match_documents` RPC for vector similarity search
 *
 * Idempotent — safe to re-run; it will drop and recreate the tables.
 * (If you have data you want to preserve, back up first.)
 */
import postgres from 'postgres';
import { config } from 'dotenv';
config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Add it to .env.local first.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 4 });

console.log('1/4 Enabling pgvector extension...');
await sql`CREATE EXTENSION IF NOT EXISTS vector`;

console.log('2/4 Dropping old tables (if present)...');
await sql`DROP TABLE IF EXISTS messages CASCADE`;
await sql`DROP TABLE IF EXISTS chats CASCADE`;
await sql`DROP TABLE IF EXISTS documents CASCADE`;
await sql`DROP TABLE IF EXISTS user_memory CASCADE`;
await sql`DROP TABLE IF EXISTS content_gaps CASCADE`;

console.log('3/4 Creating schema + RLS policies...');

// Shared RAG corpus — readable by any authenticated user.
await sql`
  CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL
  )
`;
await sql`CREATE INDEX documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops)`;
await sql`ALTER TABLE documents ENABLE ROW LEVEL SECURITY`;
await sql`CREATE POLICY "documents readable by authenticated" ON documents FOR SELECT TO authenticated USING (true)`;

// Per-user chats — each user only sees their own.
await sql`
  CREATE TABLE chats (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    title TEXT
  )
`;
await sql`CREATE INDEX chats_user_id_created_at_idx ON chats (user_id, created_at DESC)`;
await sql`ALTER TABLE chats ENABLE ROW LEVEL SECURITY`;
await sql`CREATE POLICY "chats: owner can read" ON chats FOR SELECT TO authenticated USING (auth.uid() = user_id)`;
await sql`CREATE POLICY "chats: owner can insert" ON chats FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)`;
await sql`CREATE POLICY "chats: owner can update" ON chats FOR UPDATE TO authenticated USING (auth.uid() = user_id)`;
await sql`CREATE POLICY "chats: owner can delete" ON chats FOR DELETE TO authenticated USING (auth.uid() = user_id)`;

// Messages — owned via chat_id FK. AI SDK uses short non-UUID IDs, so id is TEXT.
await sql`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    parts JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX messages_chat_id_created_at_idx ON messages (chat_id, created_at)`;
await sql`ALTER TABLE messages ENABLE ROW LEVEL SECURITY`;
await sql`CREATE POLICY "messages: read via chat ownership" ON messages FOR SELECT TO authenticated USING (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()))`;
await sql`CREATE POLICY "messages: insert via chat ownership" ON messages FOR INSERT TO authenticated WITH CHECK (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()))`;
await sql`CREATE POLICY "messages: update via chat ownership" ON messages FOR UPDATE TO authenticated USING (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()))`;

// Auto-extracted user memory — facts learned from prior conversations.
await sql`
  CREATE TABLE user_memory (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fact TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    source_chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX user_memory_user_id_idx ON user_memory (user_id, created_at DESC)`;
await sql`CREATE INDEX user_memory_embedding_idx ON user_memory USING hnsw (embedding vector_cosine_ops)`;
await sql`ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY`;
await sql`CREATE POLICY "user_memory: owner can read" ON user_memory FOR SELECT TO authenticated USING (auth.uid() = user_id)`;
await sql`CREATE POLICY "user_memory: owner can insert" ON user_memory FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)`;

// Content gaps — topics members asked about that the corpus barely covered.
// Written server-side (bypasses RLS via the direct connection); no user reads.
await sql`
  CREATE TABLE content_gaps (
    id BIGSERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    top_similarity REAL NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'web',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX content_gaps_created_at_idx ON content_gaps (created_at DESC)`;
await sql`ALTER TABLE content_gaps ENABLE ROW LEVEL SECURITY`;

console.log('4/4 Creating match_documents RPC...');
await sql`
  CREATE OR REPLACE FUNCTION match_documents(query_embedding VECTOR(1536), match_count INT DEFAULT 6)
  RETURNS TABLE (source TEXT, content TEXT, similarity FLOAT)
  LANGUAGE SQL STABLE AS $$
    SELECT source, content, 1 - (embedding <=> query_embedding) AS similarity
    FROM documents
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
  $$
`;

await sql.end();
console.log('\nDone. Your Supabase project is ready.');
console.log('Next: run `bun run ingest <your-training-folder>` to load your corpus.');
