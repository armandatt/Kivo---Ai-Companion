import PersonalityQuiz from '@/components/PersonalityQuiz';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Personality Quiz - Kivo',
  description: 'Discover your companion personality with Kivo',
};

export default function QuizPage() {
  redirect('/onboarding');
}
