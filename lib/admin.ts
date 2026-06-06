/**
 * Admin data layer — powers the /dashboard page.
 *
 * Uses the Supabase admin API (service role) to list auth users,
 * then joins journey, intake, and chat activity via direct postgres.
 *
 * Access control: ADMIN_EMAIL env var. If unset, any authenticated
 * user can view (useful during setup). Set it to Mary's login email
 * to lock the dashboard down.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  _sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 4, idle_timeout: 20 });
  return _sql;
}

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export type WheelScores = {
  selfWorth: number; nervousSystem: number; bodyEnergy: number;
  relationships: number; purpose: number; prosperity: number;
};

export type UserSummary = {
  userId: string;
  email: string;
  // Journey
  phase: number;
  phaseName: string;
  homework: string | null;
  // Activity
  totalChats: number;
  lastSessionAt: string | null;
  daysInactive: number | null;   // null = never had a session
  // Completeness
  intakeCompleted: boolean;
  wheelScores: WheelScores | null;
};

export type DashboardStats = {
  total: number;
  activeThisWeek: number;
  needFollowUp: number;
  withHomework: number;
};

export async function getUserSummaries(): Promise<UserSummary[]> {
  const supabase = adminSupabase();

  // Auth users (up to 1000 — enough for Mary's community)
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const users = data.users;
  if (!users.length) return [];

  const ids = users.map((u) => u.id);
  const sql = db();

  // Three parallel queries — journey, intake, and chat activity
  const [journeys, intakes, chatStats] = await Promise.all([
    sql<Array<{
      user_id: string; phase: number; phase_name: string;
      homework: string | null; updated_at: Date;
    }>>`
      SELECT user_id, phase, phase_name, homework, updated_at
      FROM user_journey
      WHERE user_id = ANY(${ids}::uuid[])
    `,

    sql<Array<{
      user_id: string;
      self_worth: number; nervous_system: number; body_energy: number;
      relationships: number; purpose: number; prosperity: number;
    }>>`
      SELECT user_id, self_worth, nervous_system, body_energy, relationships, purpose, prosperity
      FROM intake_assessment
      WHERE user_id = ANY(${ids}::uuid[])
    `,

    // Last message from the user (role = 'user') = true last active timestamp
    sql<Array<{ user_id: string; total: string; last_at: Date | null }>>`
      SELECT c.user_id,
             COUNT(DISTINCT c.id)::text AS total,
             MAX(m.created_at)         AS last_at
      FROM chats c
      JOIN messages m ON m.chat_id = c.id AND m.role = 'user'
      WHERE c.user_id = ANY(${ids}::uuid[])
      GROUP BY c.user_id
    `,
  ]);

  const journeyMap = new Map(journeys.map((j) => [j.user_id, j]));
  const intakeMap  = new Map(intakes.map((i)  => [i.user_id, i]));
  const chatMap    = new Map(chatStats.map((c) => [c.user_id, c]));

  const now        = Date.now();
  const MS_PER_DAY = 86_400_000;

  // Only surface users who have actually engaged (chats or journey set)
  return users
    .filter((u) => chatMap.has(u.id) || journeyMap.has(u.id))
    .map((u) => {
      const j  = journeyMap.get(u.id);
      const ia = intakeMap.get(u.id);
      const c  = chatMap.get(u.id);
      const lastAt      = c?.last_at ?? null;
      const daysInactive = lastAt ? Math.floor((now - lastAt.getTime()) / MS_PER_DAY) : null;

      return {
        userId:          u.id,
        email:           u.email ?? '(unknown)',
        phase:           j?.phase    ?? 1,
        phaseName:       j?.phase_name ?? 'Hidden Healer',
        homework:        j?.homework  ?? null,
        totalChats:      parseInt(c?.total ?? '0', 10),
        lastSessionAt:   lastAt?.toISOString() ?? null,
        daysInactive,
        intakeCompleted: !!ia,
        wheelScores: ia ? {
          selfWorth:     ia.self_worth,
          nervousSystem: ia.nervous_system,
          bodyEnergy:    ia.body_energy,
          relationships: ia.relationships,
          purpose:       ia.purpose,
          prosperity:    ia.prosperity,
        } : null,
      };
    })
    .sort((a, b) => {
      // Active members first, then by most-recent session descending
      const aFlag = (a.daysInactive ?? 999) >= 7;
      const bFlag = (b.daysInactive ?? 999) >= 7;
      if (aFlag !== bFlag) return aFlag ? 1 : -1;
      if (a.lastSessionAt && b.lastSessionAt)
        return new Date(b.lastSessionAt).getTime() - new Date(a.lastSessionAt).getTime();
      return 0;
    });
}

export function calcStats(users: UserSummary[]): DashboardStats {
  return {
    total:          users.length,
    activeThisWeek: users.filter((u) => (u.daysInactive ?? 999) < 7).length,
    needFollowUp:   users.filter((u) => (u.daysInactive ?? 999) >= 7).length,
    withHomework:   users.filter((u) => !!u.homework).length,
  };
}
