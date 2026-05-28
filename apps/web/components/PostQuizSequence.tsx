'use client';

import React, { useState, useEffect } from 'react';
import { ChevronRight, Clock, MapPin } from 'lucide-react';

// Sample creature data - will be replaced with backend data
const CREATURES = [
  { id: 1, name: 'Phoenix', description: 'Rises with ambition', image: '🔥' },
  { id: 2, name: 'Dragon', description: 'Breathes power', image: '🐉' },
  { id: 3, name: 'Serpent', description: 'Slithers with wisdom', image: '🐍' },
];

const COLORS = [
  { id: 1, name: 'Golden', hex: '#FFD700', bg: 'bg-yellow-400' },
  { id: 2, name: 'Cyan', hex: '#00D9A3', bg: 'bg-cyan-400' },
  { id: 3, name: 'Violet', hex: '#A78BFA', bg: 'bg-violet-400' },
  { id: 4, name: 'Coral', hex: '#FF8C42', bg: 'bg-orange-400' },
  { id: 5, name: 'Emerald', hex: '#10B981', bg: 'bg-emerald-400' },
  { id: 6, name: 'Azure', hex: '#0EA5E9', bg: 'bg-sky-400' },
];

type Step = 'persona' | 'creature-selection' | 'naming-confirm' | 'check-in' | 'egg-delivery' | 'complete';

interface QuizAnswers {
  energyPattern?: string;
  corePain?: string;
  primaryGoal?: string;
  accountabilityStyle?: string | null;
  aspirationWords?: string[];
}

interface PostQuizData {
  quizAnswers: QuizAnswers;
  personaName: string;
  personaDescription: string;
  creatureType?: number;
  creatureColor?: string;
  creatureName?: string;
  checkInTime?: string;
  timezone?: string;
}

interface PostQuizSequenceProps {
  quizAnswers: QuizAnswers;
  onComplete: (data: PostQuizData) => void;
}

export default function PostQuizSequence({ quizAnswers, onComplete }: PostQuizSequenceProps) {
  const accountabilityStyle = quizAnswers.accountabilityStyle;
  const personaName = accountabilityStyle === 'Gentle nudges' ? 'NOVA' : 'REX';
  const personaDescription =
    accountabilityStyle === 'Gentle nudges'
      ? 'Gentle progress. Real momentum.'
      : 'No excuses. Just results.';
  const [currentStep, setCurrentStep] = useState<Step>('persona');
  const [data, setData] = useState<PostQuizData>({
    quizAnswers,
    personaName,
    personaDescription,
    creatureType: undefined,
    creatureColor: undefined,
    creatureName: undefined,
    checkInTime: '08:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [showButton, setShowButton] = useState(false);
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [creaturesNameInput, setCreaturesNameInput] = useState('');

  // Persona Reveal - show button after 2 seconds
  useEffect(() => {
    if (currentStep === 'persona') {
      setShowButton(false);
      const timer = setTimeout(() => setShowButton(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

  // Naming Confirmation - auto-advance after 1.5 seconds
  useEffect(() => {
    if (currentStep === 'naming-confirm') {
      const timer = setTimeout(() => setCurrentStep('check-in'), 1500);
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

  const handleCreatureSelect = (creatureId: number) => {
    setData((prev) => ({ ...prev, creatureType: creatureId }));
  };

  const handleColorSelect = (color: { id: number; name: string; hex: string }) => {
    setSelectedColor(color.id);
    setData((prev) => ({ ...prev, creatureColor: color.hex }));
  };

  const handleCreatureNaming = () => {
    if (creaturesNameInput.trim()) {
      setData((prev) => ({ ...prev, creatureName: creaturesNameInput }));
      setCurrentStep('naming-confirm');
      setCreaturesNameInput('');
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setData((prev) => ({ ...prev, checkInTime: e.target.value }));
  };

  const handleCheckInSubmit = () => {
    setCurrentStep('egg-delivery');
  };

  const handleComplete = () => {
    onComplete(data);
  };

  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center overflow-hidden">
      {/* Step 1: Persona Reveal */}
      {currentStep === 'persona' && (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-6 animate-fade-in">
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .animate-fade-in {
              animation: fadeIn 0.8s ease-out;
            }
            .persona-name {
              animation: fadeIn 0.8s ease-out;
              font-size: clamp(4rem, 12vw, 8rem);
            }
            .persona-desc {
              animation: fadeIn 1.2s ease-out 0.3s both;
            }
            .persona-button {
              animation: fadeIn 0.6s ease-out 2s both;
            }
          `}</style>

          <h1 className="persona-name font-black text-white mb-6" style={{ letterSpacing: '0.1em' }}>
            {data.personaName}
          </h1>
          <p className="persona-desc text-gray-300 text-lg max-w-md mb-12">
            {data.personaDescription}
          </p>

          {showButton && (
            <button
              onClick={() => setCurrentStep('creature-selection')}
              className="persona-button group flex items-center gap-2 px-8 py-3 bg-cyan-400 text-black font-semibold rounded-full hover:bg-cyan-300 transition-all duration-300 transform hover:scale-105"
            >
              Meet your companion
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          )}
        </div>
      )}

      {/* Step 2: Creature Selection */}
      {currentStep === 'creature-selection' && (
        <div className="w-full h-full flex flex-col items-center justify-center px-6 py-12 overflow-y-auto animate-fade-in">
          <div className="max-w-3xl w-full">
            <h2 className="text-3xl font-bold text-white mb-2">Choose your companion</h2>
            <p className="text-gray-400 mb-8">Select a creature type</p>

            {/* Creature Cards */}
            <div className="grid grid-cols-3 gap-4 mb-10">
              {CREATURES.map((creature) => (
                <button
                  key={creature.id}
                  onClick={() => handleCreatureSelect(creature.id)}
                  className={`p-6 rounded-2xl border-2 transition-all duration-300 transform hover:scale-105 ${
                    data.creatureType === creature.id
                      ? 'border-cyan-400 bg-cyan-400/10'
                      : 'border-gray-600 bg-gray-900/50 hover:border-gray-500'
                  }`}
                >
                  <div className="text-4xl mb-3">{creature.image}</div>
                  <h3 className="text-white font-semibold text-sm">{creature.name}</h3>
                  <p className="text-gray-400 text-xs mt-1">{creature.description}</p>
                </button>
              ))}
            </div>

            {data.creatureType && (
              <>
                <p className="text-gray-400 mb-4">Choose a color</p>
                <div className="grid grid-cols-6 gap-3 mb-10">
                  {COLORS.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => handleColorSelect(color)}
                      className={`w-full aspect-square rounded-lg border-2 transition-all duration-300 transform hover:scale-110 ${
                        selectedColor === color.id ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                    />
                  ))}
                </div>

                <div className="mb-10">
                  <label className="block text-gray-300 mb-3 text-sm">
                    What are you calling it?
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={creaturesNameInput}
                      onChange={(e) => setCreaturesNameInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleCreatureNaming()}
                      placeholder="Name your companion..."
                      className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-cyan-400 focus:outline-none transition-colors"
                      autoFocus
                    />
                    <button
                      onClick={handleCreatureNaming}
                      disabled={!creaturesNameInput.trim()}
                      className="px-6 py-3 bg-cyan-400 text-black font-semibold rounded-lg hover:bg-cyan-300 transition-all duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Naming Confirmation */}
      {currentStep === 'naming-confirm' && (
        <div className="w-full h-full flex items-center justify-center text-center animate-fade-in">
          <style>{`
            .naming-confirmation {
              animation: fadeIn 0.6s ease-out;
              font-size: clamp(3rem, 10vw, 7rem);
            }
          `}</style>
          <h1 className="naming-confirmation font-black text-white" style={{ letterSpacing: '0.1em' }}>
            {data.creatureName}
          </h1>
        </div>
      )}

      {/* Step 4: Check-In Setup */}
      {currentStep === 'check-in' && (
        <div className="w-full h-full flex flex-col items-center justify-center px-6 animate-fade-in">
          <div className="max-w-md w-full">
            <h2 className="text-3xl font-bold text-white mb-2 text-center">Daily check-in</h2>
            <p className="text-gray-400 text-center mb-10">
              What time tomorrow do you want me to show up?
            </p>

            <div className="bg-gray-900/50 border border-gray-700 rounded-2xl p-8 mb-8">
              <div className="flex items-center justify-center gap-3 mb-6">
                <Clock className="w-5 h-5 text-cyan-400" />
                <input
                  type="time"
                  value={data.checkInTime}
                  onChange={handleTimeChange}
                  className="text-2xl font-semibold text-white bg-transparent text-center focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                <MapPin className="w-4 h-4" />
                <span>We&apos;ll use {data.timezone?.split('/')[1] || 'your timezone'} time</span>
              </div>
            </div>

            <p className="text-gray-500 text-sm text-center mb-6">
              Pick a time that actually works, not an optimistic one
            </p>

            <button
              onClick={handleCheckInSubmit}
              className="w-full px-6 py-3 bg-cyan-400 text-black font-semibold rounded-full hover:bg-cyan-300 transition-all duration-300 transform hover:scale-105"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Egg Delivery */}
      {currentStep === 'egg-delivery' && (
        <div className="w-full h-full flex flex-col items-center justify-center text-center animate-fade-in">
          <style>{`
            .egg-animation {
              animation: fadeIn 0.8s ease-out, bounce 1s ease-in-out 0.8s infinite;
            }
            @keyframes bounce {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.05); }
            }
          `}</style>

          <div className="egg-animation text-9xl mb-8">🥚</div>
          <h2 className="text-3xl font-bold text-white mb-2">Your companion is on the way</h2>
          <p className="text-gray-400 max-w-md">
            Meet {data.creatureName} tomorrow at {data.checkInTime}
          </p>

          <button
            onClick={handleComplete}
            className="mt-12 px-8 py-3 bg-cyan-400 text-black font-semibold rounded-full hover:bg-cyan-300 transition-all duration-300 transform hover:scale-105"
          >
            Start your journey
          </button>
        </div>
      )}
    </div>
  );
}
