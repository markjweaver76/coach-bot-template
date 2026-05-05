import { AuthCard } from '@/app/_components/AuthCard';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthCard mode="signup" nextPath={next || '/'} />;
}
