'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IntakeModal } from './IntakeModal';

/**
 * Thin client wrapper rendered by the chat layout.
 *
 * If `hasIntake` is false, overlays the IntakeModal over the chat until
 * the user completes the quiz. On completion, refreshes the layout so
 * the sidebar phase tracker picks up the newly assigned phase.
 */
export function IntakeWrapper({
  hasIntake,
  children,
}: {
  hasIntake: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [done, setDone] = useState(hasIntake);

  function handleComplete() {
    setDone(true);
    // Refresh server components so the phase tracker renders immediately
    router.refresh();
  }

  return (
    <>
      {!done && <IntakeModal onComplete={handleComplete} />}
      {children}
    </>
  );
}
