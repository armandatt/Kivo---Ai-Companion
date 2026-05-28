'use client'

interface ProgressBarProps {
  progress: number
  current: number
  total: number
}

export default function ProgressBar({ progress, current, total }: ProgressBarProps) {
  return (
    <div className="mb-8">
      {/* Progress bar background */}
      <div className="h-1.5 bg-gray-800/50 rounded-full overflow-hidden border border-gray-700/30">
        {/* Filled progress */}
        <div
          className="h-full bg-teal-500 rounded-full shadow-lg shadow-teal-500/30 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Progress text */}
      <div className="mt-3 flex justify-between items-center text-sm">
        <span className="text-gray-500">Progress</span>
        <span className="text-teal-400 font-semibold">
          {current}/{total}
        </span>
      </div>
    </div>
  )
}
