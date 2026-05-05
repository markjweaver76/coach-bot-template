import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { BRAND } from './brand';

const EMBED_MODEL = openai.embedding(BRAND.embeddingModel); // 1536 dims

export async function embedOne(value: string): Promise<number[]> {
  const { embedding } = await embed({ model: EMBED_MODEL, value });
  return embedding;
}

export async function embedBatch(values: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: EMBED_MODEL, values });
  return embeddings;
}
