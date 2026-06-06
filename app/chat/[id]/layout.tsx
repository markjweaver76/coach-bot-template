import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listChats } from '@/lib/db';
import { getJourney } from '@/lib/journey';
import { getIntake } from '@/lib/intake';
import { getUser } from '@/lib/supabase/server';
import { Sidebar } from '@/app/_components/Sidebar';
import { IntakeWrapper } from '@/app/_components/IntakeWrapper';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const [chats, journey, intake] = await Promise.all([
    listChats(user.id),
    getJourney(user.id),
    getIntake(user.id),
  ]);
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = adminEmail ? user.email === adminEmail : false;
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--cream, #FAF3E8)' }}>
      <Sidebar chats={chats} email={user.email ?? null} journey={journey} isAdmin={isAdmin} />
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>
        <IntakeWrapper hasIntake={!!intake}>
          {children}
        </IntakeWrapper>
      </div>
    </div>
  );
}
