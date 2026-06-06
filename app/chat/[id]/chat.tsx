'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UIMessage } from 'ai';
import { BRAND } from '@/lib/brand';

type Attachment = {
  id: string;
  file: File;
  dataUrl: string;
  kind: 'image' | 'doc';
};

const ACCEPTED_MIME =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type AffirmationData = { lines: string[]; theme: string; identityWord: string };

export function Chat({ id, initialMessages }: { id: string; initialMessages: UIMessage[] }) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [affirmation, setAffirmation] = useState<AffirmationData | null>(null);
  const [affirmationLoading, setAffirmationLoading] = useState(false);
  const { messages, sendMessage, status } = useChat({ id, messages: initialMessages });

  async function buildAffirmation() {
    if (affirmationLoading) return;
    setAffirmationLoading(true);
    try {
      const simplified = messages.map((m) => ({
        role: m.role,
        text: m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text).join(' '),
      }));
      const res = await fetch('/api/affirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: simplified }),
      });
      const data = await res.json();
      if (data.lines?.length) setAffirmation(data);
    } catch { /* ignore */ }
    finally { setAffirmationLoading(false); }
  }

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
        file, dataUrl,
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
    sendMessage(trimmed ? { text: trimmed, files: filesParts } : { files: filesParts }, { body: { chatId: id } });
    setInput('');
    setAttachments([]);
    setAttachmentError(null);
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'relative',
      background: `
        radial-gradient(70% 50% at 80% 5%, var(--teal-mist), transparent 65%),
        radial-gradient(60% 45% at 10% 90%, var(--blush-mist), transparent 65%),
        var(--cream)
      `,
    }}>
      {isEmpty ? (
        <EmptyHero input={input} setInput={setInput} send={send} isLoading={isLoading}
          attachments={attachments} addFiles={addFiles} removeAttachment={removeAttachment}
          attachmentError={attachmentError} />
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px 160px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
              <div ref={bottomRef} />
            </div>
          </div>
          {/* Affirmation card — shown when generated */}
          {affirmation && affirmation.lines.length > 0 && (
            <div style={{ maxWidth: 720, margin: '0 auto 8px', padding: '0 24px' }}>
              <AffirmationCard data={affirmation} onClose={() => setAffirmation(null)} />
            </div>
          )}

          {/* Affirmation button — visible after 6+ messages */}
          {messages.length >= 6 && !affirmation && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
              <button
                type="button"
                onClick={buildAffirmation}
                disabled={affirmationLoading}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  padding: '7px 16px',
                  borderRadius: 'var(--r-pill)',
                  border: '1px solid var(--line-teal)',
                  background: 'var(--surface)',
                  color: 'var(--teal-deep)',
                  cursor: affirmationLoading ? 'wait' : 'pointer',
                  opacity: affirmationLoading ? 0.6 : 1,
                  boxShadow: 'var(--sh-sm)',
                }}
              >
                {affirmationLoading ? 'Creating…' : '✦ Create my affirmation'}
              </button>
            </div>
          )}

          <FloatingInput input={input} setInput={setInput} send={send} isLoading={isLoading}
            attachments={attachments} addFiles={addFiles} removeAttachment={removeAttachment}
            attachmentError={attachmentError} />
        </>
      )}
    </div>
  );
}

// ── Class recommendation detection ──────────────────────────────────────────
const CLASS_PATTERNS = [
  { pattern: /sound.?bath|singing bowl|crystal bowl/i, label: 'Sound Bath', icon: '🎵' },
  { pattern: /\bbarreFlex\b|barre class|barre session/i, label: 'BarreFlex', icon: '✨' },
  { pattern: /\bmeditat(e|ion)\b|breathwork session/i, label: 'Meditation', icon: '🌙' },
  { pattern: /\breiki\b|energy heal/i, label: 'Reiki Session', icon: '🌿' },
  { pattern: /stretch session|somatic session/i, label: 'Stretch Session', icon: '🌸' },
];

function detectClass(text: string) {
  for (const c of CLASS_PATTERNS) {
    if (c.pattern.test(text)) return c;
  }
  return null;
}

function ClassChip({ label, icon }: { label: string; icon: string }) {
  return (
    <div style={{ alignSelf: 'flex-start', marginTop: 2 }}>
      <a
        href="https://tropicalrefuge.com/classes"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
          letterSpacing: '0.02em', color: 'var(--teal-deep)',
          background: 'var(--teal-mist)', border: '1px solid var(--line-teal)',
          borderRadius: 'var(--r-pill)', padding: '6px 14px',
          textDecoration: 'none', boxShadow: 'var(--sh-sm)',
        }}
      >
        <span>{icon}</span>
        <span>Book a {label}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>→</span>
      </a>
    </div>
  );
}

function MessageBubble({ message: m }: { message: UIMessage }) {
  const text = m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text).join('');
  const fileParts = m.parts.filter(
    (p): p is { type: 'file'; mediaType: string; url: string; filename?: string } => p.type === 'file',
  );

  return (
    <div style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {fileParts.map((p, i) => {
        const isImage = (p.mediaType ?? '').startsWith('image/');
        if (isImage) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`${m.id}-f${i}`} src={p.url} alt={p.filename ?? 'attachment'}
              style={{ maxWidth: 280, maxHeight: 280, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }} />
          );
        }
        return (
          <div key={`${m.id}-f${i}`} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            padding: '8px 14px',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            fontSize: 13,
            color: 'var(--ink-2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'var(--sh-sm)',
          }}>
            <DocIcon />
            {p.filename ?? 'attachment'}
          </div>
        );
      })}
      {text && (
        <>
          <div style={{
            padding: '10px 16px',
            fontSize: 15,
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.6,
            borderRadius: m.role === 'user' ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
            background: m.role === 'user' ? 'var(--gold)' : 'var(--surface)',
            color: m.role === 'user' ? '#fff' : 'var(--ink)',
            border: m.role === 'user' ? 'none' : '1px solid var(--line)',
            boxShadow: m.role === 'user' ? '0 4px 16px rgba(164,122,61,0.22)' : 'var(--sh-sm)',
            whiteSpace: 'pre-wrap',
          }}>
            {text}
          </div>
          {m.role === 'assistant' && (() => {
            const cls = detectClass(text);
            return cls ? <ClassChip label={cls.label} icon={cls.icon} /> : null;
          })()}
        </>
      )}
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

function EmptyHero(props: HeroProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
    }}>
      {/* Wordmark */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        {BRAND.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={BRAND.logoSrc} alt={BRAND.name} style={{ width: 'min(320px, 65%)', height: 'auto', display: 'inline-block' }} />
        ) : (
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 'clamp(20px, 4vw, 34px)', letterSpacing: '0.1em', color: 'var(--teal-deep)', textTransform: 'uppercase', lineHeight: 1 }}>
              {BRAND.name.split(' ').slice(0, -1).join(' ') || BRAND.name}
            </div>
            {BRAND.name.split(' ').length > 1 && (
              <div style={{ fontFamily: 'var(--font-script)', fontSize: 'clamp(48px, 10vw, 80px)', color: 'var(--ink)', lineHeight: 0.85, marginTop: 4 }}>
                {BRAND.name.split(' ').slice(-1)[0]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hero heading */}
      <h1 style={{
        fontFamily: 'var(--font-serif)',
        fontWeight: 500,
        fontSize: 'clamp(22px, 4vw, 34px)',
        color: 'var(--ink)',
        margin: '20px 0 8px',
        textAlign: 'center',
        lineHeight: 1.15,
        letterSpacing: '-0.01em',
      }}>
        {BRAND.emptyHeroHeading}
      </h1>

      {/* First greeting */}
      <p style={{
        fontFamily: 'var(--font-serif)',
        fontStyle: 'italic',
        fontSize: 'clamp(14px, 2vw, 17px)',
        color: 'var(--ink-3)',
        margin: '0 0 36px',
        textAlign: 'center',
        lineHeight: 1.5,
      }}>
        {BRAND.firstGreeting}
      </p>

      {/* Input */}
      <div style={{ width: '100%', maxWidth: 680, position: 'relative' }}>
        <InputBox {...props} />
        <AmbientGlow />
      </div>

      {/* Goal suggestion chips */}
      <div style={{
        marginTop: 52,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
        maxWidth: 680,
        padding: '0 8px',
      }}>
        {GOALS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => props.setInput(
              g.key === 'reset'
                ? "I'd like to do my Daily Refuge Reset"
                : g.label
            )}
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              fontSize: 13,
              letterSpacing: '0.01em',
              padding: '9px 18px',
              borderRadius: 'var(--r-pill)',
              border: g.special ? '1px solid var(--line-teal)' : '1px solid var(--line)',
              background: g.special ? 'var(--teal-mist)' : 'var(--surface)',
              color: g.special ? 'var(--teal-deep)' : 'var(--ink-2)',
              cursor: 'pointer',
              boxShadow: 'var(--sh-sm)',
              transition: `background var(--dur-quick) var(--ease-calm), color var(--dur-quick) var(--ease-calm), border-color var(--dur-quick) var(--ease-calm)`,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--teal-mist)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-teal)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--teal-deep)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = g.special ? 'var(--teal-mist)' : 'var(--surface)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = g.special ? 'var(--line-teal)' : 'var(--line)';
              (e.currentTarget as HTMLButtonElement).style.color = g.special ? 'var(--teal-deep)' : 'var(--ink-2)';
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const GOALS = [
  { key: 'reset',        label: '🌅 Morning Reset', special: true },
  { key: 'myself',       label: 'Improve myself' },
  { key: 'relationship', label: 'Improve my relationship' },
  { key: 'new-love',     label: 'Attract a new relationship' },
  { key: 'health',       label: 'Improve my health' },
  { key: 'career',       label: 'Attract a new career' },
  { key: 'biz',          label: 'Grow my business' },
];

function InputBox({ input, setInput, send, isLoading, attachments, addFiles, removeAttachment, attachmentError }: HeroProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = (input.trim() || attachments.length > 0) && !isLoading;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send(); }}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: '16px 16px 12px',
        boxShadow: 'var(--sh-md)',
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
        <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{attachmentError}</div>
      )}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
        placeholder={BRAND.inputPlaceholder}
        disabled={isLoading}
        rows={1}
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontSize: 15,
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink)',
          background: 'transparent',
          minHeight: 36,
          padding: 0,
          lineHeight: 1.6,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: 'var(--ink-4)' }}
        >
          <PaperclipIcon />
        </button>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_MIME} style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); if (e.target) e.target.value = ''; }} />

        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--r-pill)',
            border: 'none',
            background: canSend ? 'var(--teal)' : 'var(--line)',
            color: canSend ? 'var(--surface)' : 'var(--ink-4)',
            cursor: canSend ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            letterSpacing: '0.04em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: canSend ? 'var(--sh-teal)' : 'none',
            transition: `background var(--dur-quick) var(--ease-calm), box-shadow var(--dur-quick) var(--ease-calm)`,
          }}
        >
          {isLoading ? 'Listening…' : (
            <>
              Send
              <ArrowUpIcon />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function FloatingInput(props: HeroProps) {
  return (
    <div style={{
      position: 'sticky',
      bottom: 0,
      background: 'linear-gradient(to bottom, transparent, var(--cream) 32%)',
      padding: '20px 24px 20px',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <InputBox {...props} />
      </div>
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  if (attachment.kind === 'image') {
    return (
      <div style={{ position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.dataUrl} alt={attachment.file.name}
          style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} />
        <RemoveButton onClick={onRemove} />
      </div>
    );
  }
  return (
    <div style={{
      position: 'relative',
      padding: '8px 12px',
      background: 'var(--surface-sink)',
      borderRadius: 'var(--r-sm)',
      fontSize: 13,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      maxWidth: 240,
      border: '1px solid var(--line)',
    }}>
      <DocIcon />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {attachment.file.name}
      </span>
      <RemoveButton onClick={onRemove} />
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove attachment"
      style={{
        position: 'absolute', top: -6, right: -6,
        width: 18, height: 18, borderRadius: '50%',
        background: 'var(--ink)', color: 'var(--surface)',
        border: 'none', cursor: 'pointer',
        fontSize: 11, lineHeight: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
      ×
    </button>
  );
}

function AmbientGlow() {
  return (
    <div aria-hidden style={{
      position: 'absolute',
      left: '6%', right: '6%', bottom: -28,
      height: 52,
      borderRadius: 999,
      background: 'linear-gradient(90deg, var(--blush) 0%, var(--teal-soft) 50%, var(--coral-soft) 100%)',
      filter: 'blur(22px)',
      opacity: 0.6,
      zIndex: 0,
      pointerEvents: 'none',
    }} />
  );
}

function PaperclipIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66L9.41 17.41a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function AffirmationCard({ data, onClose }: { data: AffirmationData; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const text = data.lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--teal-mist), var(--blush-mist))',
      border: '1px solid var(--line-teal)',
      borderRadius: 'var(--r-lg)',
      padding: '20px 24px',
      position: 'relative',
      boxShadow: 'var(--sh-blush)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--teal-deep)' }}>
            Your affirmation
          </div>
          {data.theme && (
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {data.theme}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 18, lineHeight: 1, padding: 4 }}
          aria-label="Close"
        >×</button>
      </div>

      {/* Affirmation lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {data.lines.map((line, i) => (
          <div key={i} style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 'clamp(15px, 2.5vw, 18px)',
            color: 'var(--ink)',
            lineHeight: 1.4,
          }}>
            {line}
          </div>
        ))}
      </div>

      {/* Identity word + copy */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {data.identityWord && (
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--surface)',
            background: 'var(--teal-deep)',
            padding: '5px 14px',
            borderRadius: 'var(--r-pill)',
          }}>
            I am {data.identityWord}
          </div>
        )}
        <button
          onClick={copy}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--teal-deep)',
            background: 'none',
            border: '1px solid var(--line-teal)',
            borderRadius: 'var(--r-pill)',
            padding: '5px 14px',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
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
