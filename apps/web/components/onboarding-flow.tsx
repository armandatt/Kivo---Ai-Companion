'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PersonalityQuiz from '@/components/PersonalityQuiz';
import PostQuizSequence from '@/components/PostQuizSequence';

type OnboardingStep = 'quiz' | 'post-quiz' | 'complete';

interface QuizAnswers {
  energyPattern?: string;
  corePain?: string;
  mentorDomain?: string | null;
  primaryGoal?: string;
  accountabilityStyle?: string | null;
  aspirationWords?: string[];
}

interface PostQuizData {
  quizAnswers: QuizAnswers;
  personaName: string;
  personaDescription: string;
  toneModifier?: string;
  creatureType?: number;
  creatureColor?: string;
  creatureName?: string;
  checkInTime?: string;
  timezone?: string;
}

function OnboardingFlowContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<OnboardingStep>('quiz');
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswers>({});
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const stepParam = searchParams.get('step') as OnboardingStep | null;
    if (stepParam && ['quiz', 'post-quiz', 'complete'].includes(stepParam)) {
      setStep(stepParam);
      if (stepParam === 'post-quiz') {
        setQuizAnswers({
          energyPattern: 'Morning person',
          corePain: 'Procrastination',
          primaryGoal: 'Ship a product',
          accountabilityStyle: 'Gentle nudges',
          aspirationWords: ['Ambitious', 'Creative', 'Kind'],
        });
      }
    }
  }, [searchParams]);

  const handleQuizComplete = (answers: QuizAnswers) => {
    setQuizAnswers(answers);
    setStep('post-quiz');
  };

  const handlePostQuizComplete = async (data: PostQuizData) => {
    setError('');
    setIsSaving(true);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result.error ?? 'Could not save onboarding.');
        return;
      }

      setStep('complete');
      setTimeout(() => router.push('/dashboard'), 800);
    } catch {
      setError('Something went wrong while saving onboarding.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full min-h-screen">
      {step === 'quiz' && <PersonalityQuiz onComplete={handleQuizComplete} />}
      {step === 'post-quiz' && (
        <PostQuizSequence quizAnswers={quizAnswers} onComplete={handlePostQuizComplete} />
      )}
      {step === 'complete' && (
        <div className="w-full h-screen flex items-center justify-center bg-black text-white text-center">
          <div>
            <h1 className="text-4xl font-bold mb-4">Welcome to Kivo!</h1>
            <p className="text-gray-400">Taking you to your dashboard...</p>
          </div>
        </div>
      )}
      {(isSaving || error) && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-md border border-gray-700 bg-gray-950 px-4 py-3 text-center text-sm text-white shadow-2xl">
          {isSaving ? 'Saving your companion...' : error}
        </div>
      )}
    </div>
  );
}

export default function OnboardingFlow() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlowContent />
    </Suspense>
  );
}
