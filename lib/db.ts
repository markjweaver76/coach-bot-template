import postgres from 'postgres';
import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local or your Vercel project env vars.');
  }
  _sql = postgres(process.env.DATABASE_URL, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return _sql;
}

export type ChatListItem = {
  id: string;
  title: string;
  createdAt: string;
};

export async function listChats(userId: string, limit = 30): Promise<ChatListItem[]> {
  const sql = db();
  const rows = await sql<
    Array<{
      id: string;
      created_at: Date;
      title: string | null;
      first_user_text: string | null;
    }>
  >`
    SELECT
      c.id,
      c.created_at,
      c.title,
      (
        SELECT (parts->0->>'text')
        FROM messages m
        WHERE m.chat_id = c.id AND m.role = 'user'
        ORDER BY m.created_at ASC
        LIMIT 1
      ) AS first_user_text
    FROM chats c
    WHERE c.user_id = ${userId}
      AND EXISTS (SELECT 1 FROM messages WHERE chat_id = c.id)
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    title:
      r.title?.trim() ||
      (r.first_user_text ? r.first_user_text.replace(/\s+/g, ' ').trim().slice(0, 60) : 'New chat'),
    createdAt: r.created_at.toISOString(),
  }));
}

export async function createChat(userId: string, title: string | null = null): Promise<string> {
  const sql = db();
  const id = randomUUID();
  await sql`INSERT INTO chats (id, user_id, title) VALUES (${id}, ${userId}, ${title})`;
  return id;
}

export async function chatBelongsToUser(chatId: string, userId: string): Promise<boolean> {
  const sql = db();
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM chats WHERE id = ${chatId} AND user_id = ${userId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function loadChat(chatId: string, userId: string): Promise<UIMessage[]> {
  const sql = db();
  // Defensive: only return messages if the chat belongs to the user.
  const rows = await sql<
    Array<{ id: string; role: string; parts: unknown; created_at: Date }>
  >`
    SELECT m.id, m.role, m.parts, m.created_at
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    WHERE m.chat_id = ${chatId} AND c.user_id = ${userId}
    ORDER BY m.created_at ASC
  `;

  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage['role'],
    parts: r.parts as UIMessage['parts'],
  })) as UIMessage[];
}

export async function saveChat({
  chatId,
  userId,
  messages,
}: {
  chatId: string;
  userId: string;
  messages: UIMessage[];
}): Promise<void> {
  const sql = db();
  // Defensive ownership check before write.
  const owns = await chatBelongsToUser(chatId, userId);
  if (!owns) {
    throw new Error(`Chat ${chatId} does not belong to user ${userId}`);
  }
  for (const m of messages) {
    await sql`
      INSERT INTO messages (id, chat_id, role, parts)
      VALUES (${m.id}, ${chatId}, ${m.role}, ${sql.json(m.parts as never)})
      ON CONFLICT (id) DO UPDATE SET parts = EXCLUDED.parts
    `;
  }
}

// Title for the single rolling chat that backs the embedded Manifest with Mary
// app companion. One chat per user keeps the dashboard's activity counts clean.
const APP_CHAT_TITLE = 'Mary companion (app)';

/**
 * Persist one embedded-app conversation turn (user message + Mary's reply) to the
 * user's account, so it appears in the community dashboard's activity counts.
 * Finds the user's rolling app chat or creates it. Best-effort — callers swallow errors.
 */
export async function persistAppTurn(
  userId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  const sql = db();
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM chats
    WHERE user_id = ${userId} AND title = ${APP_CHAT_TITLE}
    ORDER BY created_at ASC LIMIT 1
  `;
  let chatId = existing[0]?.id;
  if (!chatId) {
    chatId = randomUUID();
    await sql`INSERT INTO chats (id, user_id, title) VALUES (${chatId}, ${userId}, ${APP_CHAT_TITLE})`;
  }
  const insert = (role: 'user' | 'assistant', text: string) => sql`
    INSERT INTO messages (id, chat_id, role, parts)
    VALUES (${randomUUID()}, ${chatId}, ${role}, ${sql.json([{ type: 'text', text }] as never)})
  `;
  if (userText.trim()) await insert('user', userText.trim());
  if (assistantText.trim()) await insert('assistant', assistantText.trim());
}

export async function searchDocs(
  queryEmbedding: number[],
  k = 6,
): Promise<Array<{ source: string; content: string; similarity: number }>> {
  const sql = db();
  const vec = '[' + queryEmbedding.join(',') + ']';
  return await sql<Array<{ source: string; content: string; similarity: number }>>`
    SELECT source, content, 1 - (embedding <=> ${vec}::vector) AS similarity
    FROM documents
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `;
}

export async function searchUserMemory(
  userId: string,
  queryEmbedding: number[],
  k = 5,
): Promise<Array<{ fact: string; similarity: number; createdAt: string }>> {
  const sql = db();
  const vec = '[' + queryEmbedding.join(',') + ']';
  const rows = await sql<Array<{ fact: string; similarity: number; created_at: Date }>>`
    SELECT fact, 1 - (embedding <=> ${vec}::vector) AS similarity, created_at
    FROM user_memory
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `;
  return rows.map((r) => ({
    fact: r.fact,
    similarity: r.similarity,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Inserts a fact only if no existing fact for this user is semantically close
 * (cosine similarity > 0.88). Returns true if inserted, false if deduped.
 */
export async function saveUserFact({
  userId,
  fact,
  embedding,
  sourceChatId,
}: {
  userId: string;
  fact: string;
  embedding: number[];
  sourceChatId?: string;
}): Promise<boolean> {
  const sql = db();
  const vec = '[' + embedding.join(',') + ']';
  const existing = await sql<Array<{ similarity: number }>>`
    SELECT 1 - (embedding <=> ${vec}::vector) AS similarity
    FROM user_memory
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT 1
  `;
  if (existing.length > 0 && existing[0].similarity > 0.88) return false;
  await sql`
    INSERT INTO user_memory (user_id, fact, embedding, source_chat_id)
    VALUES (${userId}, ${fact}, ${vec}::vector, ${sourceChatId ?? null})
  `;
  return true;
}
