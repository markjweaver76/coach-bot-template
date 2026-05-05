import { AuthCard } from '@/app/_components/AuthCard';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthCard mode="login" nextPath={next || '/'} />;
}
