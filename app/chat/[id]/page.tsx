import { notFound, redirect } from 'next/navigation';
import { chatBelongsToUser, loadChat } from '@/lib/db';
import { getUser } from '@/lib/supabase/server';
import { Chat } from './chat';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect('/login');
  const owns = await chatBelongsToUser(id, user.id);
  if (!owns) notFound();
  const initialMessages = await loadChat(id, user.id);
  return <Chat id={id} initialMessages={initialMessages} />;
}
