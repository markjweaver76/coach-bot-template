'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UIMessage } from 'ai';
import { BRAND } from '@/lib/brand';

type Attachment = {
  id: string;
  file: File;
  dataUrl: string; // base64 data URL — sent to server in the message parts
  kind: 'image' | 'doc';
};

const ACCEPTED_MIME =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file

export function Chat({
  id,
  initialMessages,
}: {
  id: string;
  initialMessages: UIMessage[];
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { messages, sendMessage, status } = useChat({
    id,
    messages: initialMessages,
  });

  const isLoading = status === 'streaming' || status === 'submitted';
  const isEmpty = messages.length === 0;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isEmpty) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isEmpty]);

  const wasEmpty = useRef(isEmpty);
  useEffect(() => {
    if (wasEmpty.current && !isEmpty && !isLoading) {
      wasEmpty.current = false;
      router.refresh();
    }
  }, [isEmpty, isLoading, router]);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachmentError(null);
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachmentError(`${file.name} is too large (max 8 MB).`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        dataUrl,
        kind: file.type.startsWith('image/') ? 'image' : 'doc',
      });
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function send() {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;
    const filesParts = attachments.map((a) => ({
      type: 'file' as const,
      mediaType: a.file.type,
      filename: a.file.name,
      url: a.dataUrl,
    }));
    sendMessage(
      trimmed
        ? { text: trimmed, files: filesParts }
        : { files: filesParts },
      { body: { chatId: id } },
    );
    setInput('');
    setAttachments([]);
    setAttachmentError(null);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'relative',
      }}
    >
      {isEmpty ? (
        <EmptyHero
          input={input}
          setInput={setInput}
          send={send}
          isLoading={isLoading}
          attachments={attachments}
          addFiles={addFiles}
          removeAttachment={removeAttachment}
          attachmentError={attachmentError}
        />
      ) : (
        <>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '32px 24px 160px',
            }}
          >
            <div
              style={{
                maxWidth: 720,
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
          <FloatingInput
            input={input}
            setInput={setInput}
            send={send}
            isLoading={isLoading}
            attachments={attachments}
            addFiles={addFiles}
            removeAttachment={removeAttachment}
            attachmentError={attachmentError}
          />
        </>
      )}
    </div>
  );
}

function MessageBubble({ message: m }: { message: UIMessage }) {
  const text = m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const fileParts = m.parts.filter(
    (p): p is { type: 'file'; mediaType: string; url: string; filename?: string } =>
      p.type === 'file',
  );

  return (
    <div
      style={{
        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {fileParts.map((p, i) => {
        const isImage = (p.mediaType ?? '').startsWith('image/');
        if (isImage) {
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`${m.id}-f${i}`}
              src={p.url}
              alt={p.filename ?? 'attachment'}
              style={{
                maxWidth: 280,
                maxHeight: 280,
                borderRadius: 12,
                border: '1px solid #ececec',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            />
          );
        }
        return (
          <div
            key={`${m.id}-f${i}`}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid #ececec',
              background: '#fff',
              fontSize: 13,
              color: '#444',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <DocIcon />
            {p.filename ?? 'attachment'}
          </div>
        );
      })}
      {text && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 15,
            borderRadius: 14,
            background: m.role === 'user' ? BRAND.accentColor : '#fff',
            color: m.role === 'user' ? '#fff' : '#111',
            border: m.role === 'user' ? 'none' : '1px solid #ececec',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function EmptyHero(props: HeroProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <Logo />
      <h1
        style={{
          fontSize: 32,
          fontWeight: 600,
          margin: '24px 0 0',
          color: '#111',
          textAlign: 'center',
        }}
      >
        {BRAND.emptyHeroHeading}
      </h1>

      <div
        style={{
          marginTop: 40,
          width: '100%',
          maxWidth: 680,
          position: 'relative',
        }}
      >
        <InputBox {...props} />
        <GradientGlow />
      </div>
    </div>
  );
}

type HeroProps = {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  isLoading: boolean;
  attachments: Attachment[];
  addFiles: (files: FileList | null) => void;
  removeAttachment: (id: string) => void;
  attachmentError: string | null;
};

function InputBox({
  input,
  setInput,
  send,
  isLoading,
  attachments,
  addFiles,
  removeAttachment,
  attachmentError,
}: HeroProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      style={{
        position: 'relative',
        background: '#fff',
        border: '1px solid #d8d8d8',
        borderRadius: 18,
        padding: '14px 16px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        zIndex: 1,
      }}
    >
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}
      {attachmentError && (
        <div style={{ color: '#c43657', fontSize: 13, marginBottom: 8 }}>{attachmentError}</div>
      )}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={BRAND.inputPlaceholder}
        disabled={isLoading}
        rows={1}
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontSize: 16,
          fontFamily: 'inherit',
          color: '#111',
          background: 'transparent',
          minHeight: 36,
          padding: 0,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          style={{
            padding: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <PaperclipIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME}
          style={{ display: 'none' }}
          onChange={(e) => {
            addFiles(e.target.files);
            if (e.target) e.target.value = '';
          }}
        />
        <button
          type="submit"
          disabled={isLoading || (!input.trim() && attachments.length === 0)}
          aria-label="Send"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background:
              (input.trim() || attachments.length > 0) && !isLoading ? '#111' : '#e5e5e5',
            color: '#fff',
            cursor:
              (input.trim() || attachments.length > 0) && !isLoading ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 120ms',
          }}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </form>
  );
}

function FloatingInput(props: HeroProps) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'linear-gradient(to bottom, transparent, #fafafa 30%)',
        padding: '24px 24px 20px',
      }}
    >
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <InputBox {...props} />
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  if (attachment.kind === 'image') {
    return (
      <div style={{ position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.dataUrl}
          alt={attachment.file.name}
          style={{
            width: 60,
            height: 60,
            objectFit: 'cover',
            borderRadius: 10,
            border: '1px solid #ddd',
          }}
        />
        <RemoveButton onClick={onRemove} />
      </div>
    );
  }
  return (
    <div
      style={{
        position: 'relative',
        padding: '8px 12px',
        background: '#f3f3f3',
        borderRadius: 10,
        fontSize: 13,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 240,
      }}
    >
      <DocIcon />
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {attachment.file.name}
      </span>
      <RemoveButton onClick={onRemove} />
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove attachment"
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#111',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      ×
    </button>
  );
}

function GradientGlow() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: '4%',
        right: '4%',
        bottom: -34,
        height: 64,
        borderRadius: 999,
        background:
          'linear-gradient(90deg, #ff8fa3 0%, #d6a4ff 25%, #8db8ff 50%, #7fe2c8 72%, #f7e88a 100%)',
        filter: 'blur(28px)',
        opacity: 0.65,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

function Logo() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={BRAND.logoSrc}
      alt={BRAND.name}
      style={{
        width: 'min(420px, 70%)',
        height: 'auto',
        display: 'block',
      }}
    />
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#888"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66L9.41 17.41a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#666"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
