/**
 * Server-side text extraction for non-image attachments.
 *
 * GPT-5.5 vision handles images natively, but PDFs and DOCX files need their
 * text pulled out before the model can use them. We do this at request time
 * so users can attach a doc and ask questions about it without us persisting
 * the file anywhere.
 */
import type { UIMessage } from 'ai';

const MAX_EXTRACTED_CHARS = 24_000; // safety cap per file (~6k tokens)

type FilePart = {
  type: 'file';
  mediaType?: string;
  filename?: string;
  url: string; // data URL
};

function isFilePart(p: unknown): p is FilePart {
  return (
    !!p &&
    typeof p === 'object' &&
    (p as { type?: unknown }).type === 'file' &&
    typeof (p as { url?: unknown }).url === 'string'
  );
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

async function extractFromBuffer(mediaType: string, buf: Buffer): Promise<string | null> {
  if (mediaType === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const { text } = await pdfParse(buf);
    return text.trim();
  }
  if (
    mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value.trim();
  }
  if (mediaType === 'text/plain' || mediaType === 'text/markdown') {
    return buf.toString('utf8').trim();
  }
  return null;
}

/**
 * Walk all user messages, extract text from non-image file parts, and rewrite
 * those parts as a text part so the model receives the content.
 *
 * Image file parts are left untouched — gpt-5.5 vision sees them directly.
 *
 * Returns a NEW messages array; does not mutate the original.
 */
export async function inlineNonImageAttachments(
  messages: UIMessage[],
): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== 'user') return m;
      const newParts: typeof m.parts = [];
      for (const part of m.parts) {
        if (!isFilePart(part)) {
          newParts.push(part);
          continue;
        }
        const mt = part.mediaType ?? '';
        if (mt.startsWith('image/')) {
          newParts.push(part);
          continue;
        }
        const buf = dataUrlToBuffer(part.url);
        if (!buf) {
          newParts.push(part);
          continue;
        }
        try {
          const text = await extractFromBuffer(mt, buf);
          if (text) {
            const trimmed =
              text.length > MAX_EXTRACTED_CHARS
                ? text.slice(0, MAX_EXTRACTED_CHARS) + '\n\n[...truncated]'
                : text;
            newParts.push({
              type: 'text',
              text: `[Attached file: ${part.filename ?? 'document'}]\n${trimmed}`,
            });
          }
          // If extraction yields nothing, drop the part silently.
        } catch (err) {
          console.error('[extract-text] failed for', part.filename, err);
        }
      }
      return { ...m, parts: newParts };
    }),
  );
}
