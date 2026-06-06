import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listChats } from '@/lib/db';
import { getJourney } from '@/lib/journey';
import { getUser } from '@/lib/supabase/server';
import { Sidebar } from '@/app/_components/Sidebar';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const [chats, journey] = await Promise.all([
    listChats(user.id),
    getJourney(user.id),
  ]);
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--cream, #FAF3E8)' }}>
      <Sidebar chats={chats} email={user.email ?? null} journey={journey} />
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>{children}</div>
    </div>
  );
}
