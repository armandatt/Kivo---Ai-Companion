"use client";
import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

type SparklesProps = {
  id?: string;
  className?: string;
  particleColor?: string;
  particleDensity?: number;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  background?: string;
};

// Deterministic pseudo-random so SSR and client produce the same layout.
function seededRandom(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

export function SparklesCore({
  className,
  particleColor = "#00E5A0",
  particleDensity = 80,
  minSize = 0.5,
  maxSize = 2,
  speed = 2,
}: SparklesProps) {
  const dots = useMemo(() => {
    return Array.from({ length: particleDensity }, (_, i) => ({
      left: seededRandom(i * 3) * 100,
      top: seededRandom(i * 3 + 1) * 100,
      size: minSize + seededRandom(i * 3 + 2) * (maxSize - minSize),
      duration: (2 + seededRandom(i * 7) * 3) / speed,
      delay: seededRandom(i * 11) * 4,
      opacity: 0.08 + seededRandom(i * 13) * 0.55,
    }));
  }, [particleDensity, minSize, maxSize, speed]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <style>{`
        @keyframes sparkle-twinkle {
          0%, 100% { opacity: var(--spark-lo); transform: scale(1); }
          50%       { opacity: var(--spark-hi); transform: scale(1.4); }
        }
      `}</style>
      {dots.map((d, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: `${d.size}px`,
            height: `${d.size}px`,
            borderRadius: "50%",
            background: particleColor,
            "--spark-lo": d.opacity * 0.15,
            "--spark-hi": d.opacity,
            animation: `sparkle-twinkle ${d.duration}s ease-in-out ${d.delay}s infinite`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
