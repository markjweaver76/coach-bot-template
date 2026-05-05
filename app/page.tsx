import { redirect } from 'next/navigation';
import { createChat } from '@/lib/db';
import { getUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getUser();
  if (!user) redirect('/login');
  const id = await createChat(user.id);
  redirect(`/chat/${id}`);
}
