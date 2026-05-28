'use client'

import { useState } from 'react'

interface Option {
  label: string
  value: string
}

interface Question {
  id: string
  question: string
  options: Option[]
}

interface QuestionCardProps {
  question: Question
  onAnswer: (value: string | string[]) => void
  isLoading: boolean
  isSelected: (value: string) => boolean
}

export default function QuestionCard({
  question,
  onAnswer,
  isLoading,
  isSelected,
}: QuestionCardProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const handleClick = (value: string) => {
    if (!isLoading) {
      onAnswer(value)
    }
  }

  return (
    <div className="bg-gradient-to-br from-gray-900/50 to-gray-800/30 backdrop-blur-xl border border-gray-700/30 rounded-3xl p-8 md:p-12 shadow-2xl">
      {/* Question Text */}
      <h2 className="text-2xl md:text-3xl font-bold text-white mb-10 leading-tight">
        {question.question}
      </h2>

      {/* Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {question.options.map((option, index) => (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            disabled={isLoading}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            className="group relative overflow-hidden rounded-2xl p-6 text-left transition-all duration-300 transform hover:scale-105 disabled:cursor-wait"
          >
            {/* Background with gradient */}
            <div
              className={`absolute inset-0 transition-all duration-300 ${
                isSelected(option.value)
                  ? 'bg-teal-500/30 shadow-lg shadow-teal-500/30'
                  : hoveredIndex === index
                    ? 'bg-gray-700/60 shadow-lg shadow-gray-500/20'
                    : 'bg-gray-800/40'
              }`}
            />

            {/* Border effect */}
            <div
              className={`absolute inset-0 rounded-2xl border transition-all duration-300 ${
                isSelected(option.value)
                  ? 'border-teal-400/60'
                  : hoveredIndex === index
                    ? 'border-gray-600/60'
                    : 'border-gray-700/30'
              }`}
            />

            {/* Shine effect on hover */}
            {hoveredIndex === index && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -skew-x-12 animate-pulse" />
            )}

            {/* Content */}
            <div className="relative z-10 flex items-center gap-4">
              {/* Radio circle */}
              <div
                className={`flex-shrink-0 w-6 h-6 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${
                  isSelected(option.value)
                    ? 'border-teal-400 bg-teal-500/20'
                    : hoveredIndex === index
                      ? 'border-gray-500 bg-gray-700/30'
                      : 'border-gray-600 bg-gray-800/30'
                }`}
              >
                {isSelected(option.value) && (
                  <div className="w-3 h-3 bg-teal-400 rounded-full animate-pulse" />
                )}
              </div>

              {/* Label text */}
              <span
                className={`font-medium text-base transition-all duration-300 ${
                  isSelected(option.value)
                    ? 'text-white'
                    : hoveredIndex === index
                      ? 'text-gray-100'
                      : 'text-gray-300'
                }`}
              >
                {option.label}
              </span>
            </div>

            {/* Animated border on selection */}
            {isSelected(option.value) && (
              <div className="absolute inset-0 rounded-2xl border-2 border-teal-400/50 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Helpful text */}
      <p className="mt-8 text-center text-gray-500 text-sm">
        Select the response that best describes you
      </p>
    </div>
  )
}
