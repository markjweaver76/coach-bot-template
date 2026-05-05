import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listChats } from '@/lib/db';
import { getUser } from '@/lib/supabase/server';
import { Sidebar } from '@/app/_components/Sidebar';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const chats = await listChats(user.id);
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fafafa' }}>
      <Sidebar chats={chats} email={user.email ?? null} />
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>{children}</div>
    </div>
  );
}
