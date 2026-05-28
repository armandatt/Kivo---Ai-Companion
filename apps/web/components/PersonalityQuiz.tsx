'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';

interface QuizAnswers {
  energyPattern: string;
  corePain: string;
  primaryGoal: string;
  accountabilityStyle: string | null;
  aspirationWords: [string, string, string] | ['', '', ''];
}

interface PersonalityQuizProps {
  onComplete: (answers: QuizAnswers) => void;
}

const questions = [
  {
    id: 1,
    title: 'Energy pattern',
    question: "It's 7am on a Tuesday. Which version of you shows up?",
    type: 'text',
    hint: '',
  },
  {
    id: 2,
    title: 'Core pain point',
    question: "What's the one thing you keep saying you'll fix but never do?",
    type: 'text',
    hint: 'be honest, nobody\'s watching',
  },
  {
    id: 3,
    title: '30-day goal',
    question: 'What does a win look like for you in 30 days?',
    type: 'text',
    hint: '',
  },
  {
    id: 4,
    title: 'Accountability style',
    question: 'How do you want to be pushed?',
    type: 'cards',
    options: ['Gentle nudges', 'No mercy'],
  },
  {
    id: 5,
    title: 'Aspiration anchor',
    question: 'Describe the ideal version of yourself in 3 words.',
    type: 'three-words',
    hint: '',
  },
];

export default function PersonalityQuiz({ onComplete }: PersonalityQuizProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({
    energyPattern: '',
    corePain: '',
    primaryGoal: '',
    accountabilityStyle: null,
    aspirationWords: ['', '', ''],
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const word1Ref = useRef<HTMLInputElement>(null);
  const word2Ref = useRef<HTMLInputElement>(null);
  const word3Ref = useRef<HTMLInputElement>(null);

  const question = questions[currentQuestion];
  const progress = ((currentQuestion + 1) / questions.length) * 100;

  // Auto-focus input on question change
  useEffect(() => {
    if (question.type === 'text') {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (question.type === 'three-words') {
      setTimeout(() => word1Ref.current?.focus(), 100);
    }
  }, [currentQuestion, question.type]);

  const getCurrentAnswer = (): string => {
    switch (currentQuestion) {
      case 0:
        return answers.energyPattern;
      case 1:
        return answers.corePain;
      case 2:
        return answers.primaryGoal;
      case 4:
        return answers.aspirationWords.join(' ');
      default:
        return '';
    }
  };

  const isAnswerFilled = (): boolean => {
    if (question.type === 'cards') {
      return answers.accountabilityStyle !== null;
    } else if (question.type === 'three-words') {
      return (
        answers.aspirationWords[0].trim() !== '' &&
        answers.aspirationWords[1].trim() !== '' &&
        answers.aspirationWords[2].trim() !== ''
      );
    }
    return getCurrentAnswer().trim().length > 0;
  };

  const handleTextInput = (value: string) => {
    const newAnswers = { ...answers };
    if (currentQuestion === 0) newAnswers.energyPattern = value;
    else if (currentQuestion === 1) newAnswers.corePain = value;
    else if (currentQuestion === 2) newAnswers.primaryGoal = value;
    setAnswers(newAnswers);
  };

  const handleCardSelect = (option: string) => {
    setAnswers({ ...answers, accountabilityStyle: option });
    setTimeout(() => {
      if (currentQuestion < questions.length - 1) {
        goToNextQuestion();
      }
    }, 300);
  };

  const handleWordInput = (index: number, value: string) => {
    const newWords = [...answers.aspirationWords] as [string, string, string];
    newWords[index] = value.replace(/\s+/g, '');
    setAnswers({ ...answers, aspirationWords: newWords });
  };

  const handleWordTabKey = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (index === 0) word2Ref.current?.focus();
      else if (index === 1) word3Ref.current?.focus();
      else if (index === 2) word1Ref.current?.focus();
    }
  };

  const goToNextQuestion = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentQuestion((prev) => Math.min(prev + 1, questions.length - 1));
      setIsTransitioning(false);
    }, 300);
  };

  const handleNext = () => {
    if (!isAnswerFilled()) return;
    goToNextQuestion();
  };

  const handleBack = () => {
    if (currentQuestion === 0) return;

    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentQuestion((prev) => Math.max(prev - 1, 0));
      setIsTransitioning(false);
    }, 300);
  };

  const handleSkip = () => {
    if (currentQuestion === questions.length - 1) {
      onComplete(answers);
      return;
    }
    goToNextQuestion();
  };

  const handleComplete = () => {
    if (!isAnswerFilled()) return;
    onComplete(answers);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex gap-1 h-1 bg-[#1a1a24] rounded-full overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-[#00D9A3] transition-all duration-500 rounded-full"
                style={{
                  opacity: i < currentQuestion + 1 ? 1 : 0.2,
                }}
              />
            ))}
          </div>
        </div>

        {/* Question Counter */}
        <div className="text-right text-xs text-gray-500 mb-8">
          {currentQuestion + 1} of {questions.length}
        </div>

        {/* Question Content */}
        <div
          className={`transition-all duration-300 ${
            isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
          }`}
        >
          {/* Question Title */}
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-[#00D9A3] uppercase tracking-wider">
              {question.title}
            </h3>
          </div>

          {/* Question Text */}
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 leading-tight">
            {question.question}
          </h2>

          {/* Input Area */}
          <div className="mb-8">
            {question.type === 'text' && (
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={getCurrentAnswer()}
                  onChange={(e) => handleTextInput(e.target.value)}
                  placeholder="Type your answer..."
                  className="w-full bg-[#1a1a24] border border-[#00D9A3] border-opacity-30 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#00D9A3] focus:border-opacity-100 focus:ring-1 focus:ring-[#00D9A3] focus:ring-opacity-20 transition-all duration-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isAnswerFilled()) {
                      handleNext();
                    }
                  }}
                />
                {question.hint && (
                  <p className="text-xs text-gray-600 mt-2">{question.hint}</p>
                )}
              </div>
            )}

            {question.type === 'cards' && (
              <div className="grid grid-cols-2 gap-4">
                {question.options?.map((option) => (
                  <button
                    key={option}
                    onClick={() => handleCardSelect(option)}
                    className={`p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
                      answers.accountabilityStyle === option
                        ? 'border-[#00D9A3] bg-[#00D9A3] bg-opacity-10'
                        : 'border-[#1a1a24] bg-[#1a1a24] hover:border-[#00D9A3] hover:border-opacity-50'
                    }`}
                  >
                    <p className="text-white font-semibold text-center">{option}</p>
                  </button>
                ))}
              </div>
            )}

            {question.type === 'three-words' && (
              <div className="flex gap-3">
                <input
                  ref={word1Ref}
                  type="text"
                  value={answers.aspirationWords[0]}
                  onChange={(e) => handleWordInput(0, e.target.value)}
                  onKeyDown={(e) => handleWordTabKey(e, 0)}
                  placeholder="Word 1"
                  maxLength={15}
                  className="flex-1 bg-[#1a1a24] border border-[#00D9A3] border-opacity-30 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#00D9A3] focus:border-opacity-100 focus:ring-1 focus:ring-[#00D9A3] focus:ring-opacity-20 transition-all duration-200"
                />
                <input
                  ref={word2Ref}
                  type="text"
                  value={answers.aspirationWords[1]}
                  onChange={(e) => handleWordInput(1, e.target.value)}
                  onKeyDown={(e) => handleWordTabKey(e, 1)}
                  placeholder="Word 2"
                  maxLength={15}
                  className="flex-1 bg-[#1a1a24] border border-[#00D9A3] border-opacity-30 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#00D9A3] focus:border-opacity-100 focus:ring-1 focus:ring-[#00D9A3] focus:ring-opacity-20 transition-all duration-200"
                />
                <input
                  ref={word3Ref}
                  type="text"
                  value={answers.aspirationWords[2]}
                  onChange={(e) => handleWordInput(2, e.target.value)}
                  onKeyDown={(e) => handleWordTabKey(e, 2)}
                  placeholder="Word 3"
                  maxLength={15}
                  className="flex-1 bg-[#1a1a24] border border-[#00D9A3] border-opacity-30 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#00D9A3] focus:border-opacity-100 focus:ring-1 focus:ring-[#00D9A3] focus:ring-opacity-20 transition-all duration-200"
                />
              </div>
            )}
          </div>

          {/* Skip Link */}
          {question.type !== 'cards' && (
            <div className="mb-8">
              <button
                onClick={handleSkip}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors duration-200"
              >
                skip this one →
              </button>
            </div>
          )}
        </div>

        {/* Button Controls */}
        <div className="flex items-center justify-between mt-12">
          <button
            onClick={handleBack}
            disabled={currentQuestion === 0}
            className="p-2 rounded-lg hover:bg-[#1a1a24] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>

          {currentQuestion === questions.length - 1 ? (
            <button
              onClick={handleComplete}
              disabled={!isAnswerFilled()}
              className={`px-8 py-2 rounded-full font-semibold transition-all duration-200 ${
                isAnswerFilled()
                  ? 'bg-[#00D9A3] text-[#0a0a0a] hover:bg-[#00D9A3] hover:shadow-lg hover:shadow-[#00D9A3]/20 cursor-pointer'
                  : 'bg-[#00D9A3] bg-opacity-30 text-white cursor-not-allowed'
              }`}
            >
              Complete
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!isAnswerFilled()}
              className={`px-8 py-2 rounded-full font-semibold transition-all duration-200 ${
                isAnswerFilled()
                  ? 'bg-[#00D9A3] text-[#0a0a0a] hover:bg-[#00D9A3] hover:shadow-lg hover:shadow-[#00D9A3]/20 cursor-pointer'
                  : 'bg-[#00D9A3] bg-opacity-30 text-white cursor-not-allowed'
              }`}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
