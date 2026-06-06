'use client';

import { useState } from 'react';
import type { WheelScores } from '@/lib/intake';

const QUESTIONS: Array<{
  key: keyof WheelScores;
  wheel: string;
  emoji: string;
  question: string;
  low: string;
  high: string;
}> = [
  {
    key: 'selfWorth',
    wheel: 'Self-Worth',
    emoji: '✨',
    question: 'How often do you feel truly worthy of love, success, and good things — without having to earn them?',
    low: 'Rarely — I\'m always trying to prove myself',
    high: 'Most of the time — I know I am enough',
  },
  {
    key: 'nervousSystem',
    wheel: 'Nervous System',
    emoji: '🌊',
    question: 'How would you describe your nervous system right now?',
    low: 'Constantly on edge, exhausted, or numb',
    high: 'Calm and regulated most days',
  },
  {
    key: 'bodyEnergy',
    wheel: 'Body & Energy',
    emoji: '🌿',
    question: 'How connected and at home do you feel in your body right now?',
    low: 'Very disconnected — depleted and struggling',
    high: 'Strong, present, and in sync',
  },
  {
    key: 'relationships',
    wheel: 'Relationships',
    emoji: '💛',
    question: 'How well do you honor your own needs in your relationships?',
    low: 'I give too much and lose myself',
    high: 'I hold my limits and feel seen',
  },
  {
    key: 'purpose',
    wheel: 'Purpose',
    emoji: '🔥',
    question: 'How clear and alive does your sense of purpose feel right now?',
    low: 'Foggy — I\'m searching and unsure',
    high: 'Clear and on fire — I know my calling',
  },
  {
    key: 'prosperity',
    wheel: 'Prosperity',
    emoji: '🌸',
    question: 'How safe and trusting do you feel in your relationship with money and abundance?',
    low: 'Scarcity and fear — never enough',
    high: 'Open and expanding — I trust the flow',
  },
];

const ANSWER_LABELS = [
  { val: 1, label: 'Struggling' },
  { val: 2, label: 'Finding my way' },
  { val: 3, label: 'Growing' },
  { val: 4, label: 'Thriving' },
  { val: 5, label: 'Fully alive' },
];

export function IntakeModal({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<Partial<WheelScores>>({});
  const [transitioning, setTransitioning] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const q = QUESTIONS[step];
  const total = QUESTIONS.length;
  const isLast = step === total - 1;

  async function select(val: number) {
    if (transitioning || submitting) return;
    const next = { ...scores, [q.key]: val };
    setScores(next);

    if (isLast) {
      setSubmitting(true);
      await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      onComplete();
    } else {
      setTransitioning(true);
      setTimeout(() => {
        setStep((s) => s + 1);
        setTransitioning(false);
      }, 200);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: `radial-gradient(110% 50% at 50% 0%, var(--teal-mist, #e8f4f4), transparent 60%), var(--cream, #FAF3E8)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
      opacity: transitioning ? 0 : 1,
      transition: 'opacity 0.18s ease',
    }}>

      {/* Header — only on first question */}
      {step === 0 && (
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-script, cursive)', fontSize: 38, color: 'var(--ink, #2C2420)', lineHeight: 1 }}>
            Before we begin
          </div>
          <div style={{ fontFamily: 'var(--font-serif, serif)', fontSize: 15, color: 'var(--ink-3, #7A6058)', marginTop: 10, fontStyle: 'italic', lineHeight: 1.6, maxWidth: 340 }}>
            A quick check-in so I can meet you where you are.<br />There are no wrong answers, beautiful.
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: step === 0 ? 24 : 40 }}>
        {QUESTIONS.map((_, i) => (
          <div key={i} style={{
            width: 36, height: 4, borderRadius: 2,
            background: i < step
              ? 'var(--teal, #4FB1AC)'
              : i === step
                ? 'var(--teal, #4FB1AC)'
                : 'var(--line, #e8e0d5)',
            opacity: i < step ? 0.55 : 1,
            transition: 'background 0.3s, opacity 0.3s',
          }} />
        ))}
      </div>

      {/* Question card */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--surface, #FFFDF8)',
        borderRadius: 24,
        padding: '32px 28px 28px',
        boxShadow: '0 8px 40px rgba(120,90,60,0.10)',
        border: '1px solid var(--line, #e8e0d5)',
      }}>
        {/* Wheel label */}
        <div style={{
          fontFamily: 'var(--font-sans, sans-serif)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'var(--teal-deep, #2D7A75)', marginBottom: 14,
        }}>
          {q.emoji}&nbsp;&nbsp;{q.wheel}
        </div>

        {/* Question text */}
        <div style={{
          fontFamily: 'var(--font-serif, serif)', fontWeight: 500, fontSize: 20,
          color: 'var(--ink, #2C2420)', lineHeight: 1.45, marginBottom: 28,
        }}>
          {q.question}
        </div>

        {/* Answer options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {ANSWER_LABELS.map(({ val, label }) => (
            <AnswerButton
              key={val}
              label={label}
              val={val}
              disabled={submitting || transitioning}
              onClick={() => select(val)}
            />
          ))}
        </div>

        {/* Anchor labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--ink-4, #A09080)', fontStyle: 'italic', lineHeight: 1.3 }}>
            {q.low}
          </span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--ink-4, #A09080)', fontStyle: 'italic', lineHeight: 1.3, textAlign: 'right' }}>
            {q.high}
          </span>
        </div>
      </div>

      {/* Sub-label on later steps */}
      {step > 0 && (
        <div style={{
          marginTop: 20, textAlign: 'center',
          fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-4, #A09080)',
          letterSpacing: '0.05em',
        }}>
          {step + 1} of {total}
        </div>
      )}
    </div>
  );
}

function AnswerButton({
  label, val, disabled, onClick,
}: {
  label: string; val: number; disabled: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '13px 16px',
        background: hovered ? 'var(--teal-mist, #e8f4f4)' : 'transparent',
        border: `1.5px solid ${hovered ? 'var(--teal, #4FB1AC)' : 'var(--line, #e8e0d5)'}`,
        borderRadius: 'var(--r-pill, 999px)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'var(--font-sans, sans-serif)', fontSize: 13.5,
        color: hovered ? 'var(--teal-deep, #2D7A75)' : 'var(--ink-2, #5C4A3F)',
        transition: 'all 0.14s',
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 11, opacity: 0.45 }}>{val}/5</span>
    </button>
  );
}
