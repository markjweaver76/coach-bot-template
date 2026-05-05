import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { embedOne } from '@/lib/embed';
import {
  chatBelongsToUser,
  saveChat,
  searchDocs,
  searchUserMemory,
} from '@/lib/db';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { extractAndStoreFacts } from '@/lib/memory';
import { inlineNonImageAttachments } from '@/lib/extract-text';
import { getUser } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { messages, chatId }: { messages: UIMessage[]; chatId: string } = await req.json();

  const owns = await chatBelongsToUser(chatId, user.id);
  if (!owns) return new Response('Forbidden', { status: 403 });

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserText =
    lastUser?.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ?? '';

  // Embed once, use for both RAG retrieval and user-memory retrieval.
  let docHits: Array<{ source: string; content: string; similarity: number }> = [];
  let memoryHits: Array<{ fact: string; similarity: number; createdAt: string }> = [];
  if (lastUserText.trim()) {
    const queryEmbedding = await embedOne(lastUserText);
    [docHits, memoryHits] = await Promise.all([
      searchDocs(queryEmbedding, 6),
      searchUserMemory(user.id, queryEmbedding, 5),
    ]);
  }

  const system = buildSystemPrompt({
    contextChunks: docHits,
    userFacts: memoryHits,
  });

  // Extract text from PDF/DOCX/TXT attachments at request time so the model sees their content.
  // Image attachments pass through untouched (gpt-5.5 vision handles them).
  const messagesForModel = await inlineNonImageAttachments(messages);

  const result = streamText({
    model: openai(BRAND.chatModel),
    system,
    messages: convertToModelMessages(messagesForModel),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      // Persist + extract memory in parallel; both fire-and-forget.
      void saveChat({ chatId, userId: user.id, messages: finalMessages });
      void extractAndStoreFacts({ userId: user.id, chatId, messages: finalMessages });
    },
  });
}
