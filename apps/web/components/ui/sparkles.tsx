"use client";
import React, { useCallback } from "react";
import Particles, { ParticlesProvider } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type SparklesProps = {
  id?: string;
  className?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

function SparklesInner({
  id,
  className,
  background,
  minSize,
  maxSize,
  speed,
  particleColor,
  particleDensity,
}: SparklesProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      className={cn("h-full w-full", className)}
    >
      <Particles
        id={id ?? "sparkles-core"}
        className="h-full w-full"
        options={{
          background: { color: { value: background ?? "transparent" } },
          fullScreen: { enable: false, zIndex: 0 },
          fpsLimit: 120,
          interactivity: {
            events: {
              onClick: { enable: false },
              onHover: { enable: false },
              resize: true as any,
            },
          },
          particles: {
            color: { value: particleColor ?? "#00E5A0" },
            move: {
              direction: "none",
              enable: true,
              outModes: { default: "out" },
              random: false,
              speed: { min: 0.1, max: 0.6 },
              straight: false,
            },
            number: {
              density: { enable: true, width: 400, height: 400 },
              value: particleDensity ?? 80,
            },
            opacity: {
              value: { min: 0.05, max: 0.6 },
              animation: {
                enable: true,
                speed: speed ?? 2,
                sync: false,
              },
            },
            shape: { type: "circle" },
            size: {
              value: { min: minSize ?? 0.5, max: maxSize ?? 2 },
            },
          },
          detectRetina: true,
        }}
      />
    </motion.div>
  );
}

// init must be stable (module-level) so ParticlesProvider doesn't throw
async function initEngine(engine: any) {
  await loadSlim(engine);
}

export function SparklesCore(props: SparklesProps) {
  // useCallback with [] guarantees the same reference on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInit = useCallback(initEngine, []);

  return (
    <ParticlesProvider init={stableInit}>
      <SparklesInner {...props} />
    </ParticlesProvider>
  );
}
