import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import OnboardingFlow from '@/components/onboarding-flow';
import { onboardingEntry, type OnboardingEntry } from '@/lib/auth/dashboard-entry';
import { sessionSecret } from '@/lib/auth/session-secret';

export const dynamic = 'force-dynamic';

async function getUserId(): Promise<string | null> {
  try {
    const token = (await cookies()).get('kevo_session')?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, sessionSecret());
    return (payload as { userId?: string }).userId ?? null;
  } catch {
    return null;
  }
}

// Onboarding is asked once. An account that has finished it goes to Today.
// As in the dashboard layout, the lookup is guarded and the redirect is made
// outside it (redirect() throws), and a database that cannot be reached
// leaves the page to be answered: the server refuses a second completion.
export default async function OnboardingPage() {
  const userId = await getUserId();
  let entry: OnboardingEntry = 'answer';
  if (userId) {
    try {
      const { prisma } = await import('@repo/db/client');
      const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { onboardingComplete: true } });
      entry = onboardingEntry({ onboardingComplete: profile?.onboardingComplete });
    } catch (err) {
      console.error('[onboarding] DB unavailable, skipping completion check:', err);
    }
  }
  if (entry !== 'answer') redirect(entry);
  return <OnboardingFlow />;
}
