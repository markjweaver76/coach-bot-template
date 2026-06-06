/**
 * /api/intake — save Balance Wheel assessment results.
 *
 * Called once after a new user completes the intake quiz.
 * Saves scores + auto-sets the starting journey phase.
 */
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { saveIntake, scoresToPhase, type WheelScores } from '@/lib/intake';
import { upsertPhase } from '@/lib/journey';

const WHEEL_KEYS: (keyof WheelScores)[] = [
  'selfWorth', 'nervousSystem', 'bodyEnergy', 'relationships', 'purpose', 'prosperity',
];

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Partial<WheelScores>;

  // Validate all 6 scores are present and in range
  for (const key of WHEEL_KEYS) {
    const val = body[key];
    if (typeof val !== 'number' || val < 1 || val > 5 || !Number.isInteger(val)) {
      return NextResponse.json({ error: `Invalid score for ${key}` }, { status: 400 });
    }
  }

  const scores = body as WheelScores;

  await saveIntake(user.id, scores);

  const phase = scoresToPhase(scores);
  await upsertPhase(user.id, phase, 'Starting phase set from Balance Wheel™ intake assessment');

  return NextResponse.json({ ok: true, phase });
}
