/**
 * Balance Wheel intake assessment — runs once at first login.
 *
 * The six areas map directly to Mary's Tropical Refuge Balance Wheel™:
 *   Self-Worth · Nervous System · Body & Energy · Relationships · Purpose · Prosperity
 *
 * Scores (1–5) are used to:
 *   1. Auto-set the user's starting phase in the Tropical Refuge Method™
 *   2. Inject wheel context into the system prompt so Mary meets her where she is
 */
import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  _sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 4, idle_timeout: 20 });
  return _sql;
}

export type WheelScores = {
  selfWorth: number;      // 1–5
  nervousSystem: number;  // 1–5
  bodyEnergy: number;     // 1–5
  relationships: number;  // 1–5
  purpose: number;        // 1–5
  prosperity: number;     // 1–5
};

export type Intake = WheelScores & {
  userId: string;
  completedAt: string;
};

// Phase a score of 1–5 maps to its label
export const SCORE_LABELS = [
  '', // index 0 unused
  'Struggling',
  'Finding my way',
  'Growing',
  'Thriving',
  'Fully alive',
] as const;

// Each wheel dimension maps to a primary phase
const WHEEL_PHASE_MAP: Array<{ key: keyof WheelScores; phase: number }> = [
  { key: 'selfWorth',     phase: 1 }, // Hidden Healer
  { key: 'nervousSystem', phase: 2 }, // The Awakening
  { key: 'bodyEnergy',    phase: 3 }, // Warrior Goddess
  { key: 'relationships', phase: 4 }, // Sovereign Woman
  { key: 'purpose',       phase: 5 }, // The Visionary
  { key: 'prosperity',    phase: 5 }, // The Visionary (same phase)
];

/** Derive starting phase from wheel scores — lowest score drives the phase. */
export function scoresToPhase(scores: WheelScores): number {
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / 6;
  if (avg >= 4.3) return 6; // all high → Magnetic Femme

  // Lowest scoring dimension determines primary growth edge
  let lowestVal = 6;
  let lowestPhase = 1;
  for (const { key, phase } of WHEEL_PHASE_MAP) {
    if (scores[key] < lowestVal) {
      lowestVal = scores[key];
      lowestPhase = phase;
    }
  }
  return lowestPhase;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getIntake(userId: string): Promise<Intake | null> {
  const sql = db();
  const rows = await sql<Array<{
    user_id: string;
    self_worth: number; nervous_system: number; body_energy: number;
    relationships: number; purpose: number; prosperity: number;
    completed_at: Date;
  }>>`SELECT * FROM intake_assessment WHERE user_id = ${userId} LIMIT 1`;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    userId:        r.user_id,
    selfWorth:     r.self_worth,
    nervousSystem: r.nervous_system,
    bodyEnergy:    r.body_energy,
    relationships: r.relationships,
    purpose:       r.purpose,
    prosperity:    r.prosperity,
    completedAt:   r.completed_at.toISOString(),
  };
}

export async function saveIntake(userId: string, scores: WheelScores): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO intake_assessment
      (user_id, self_worth, nervous_system, body_energy, relationships, purpose, prosperity)
    VALUES
      (${userId}, ${scores.selfWorth}, ${scores.nervousSystem}, ${scores.bodyEnergy},
       ${scores.relationships}, ${scores.purpose}, ${scores.prosperity})
    ON CONFLICT (user_id) DO UPDATE
      SET self_worth     = EXCLUDED.self_worth,
          nervous_system = EXCLUDED.nervous_system,
          body_energy    = EXCLUDED.body_energy,
          relationships  = EXCLUDED.relationships,
          purpose        = EXCLUDED.purpose,
          prosperity     = EXCLUDED.prosperity,
          completed_at   = now()
  `;
}
