import { memo, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

export type ThinkingDesign = 'orbits' | 'waveform' | 'constellation' | 'diffusion'

const STORAGE_KEY = 'thinking-indicator-design'
const VALID_DESIGNS: ThinkingDesign[] = ['orbits', 'waveform', 'constellation', 'diffusion']

function readDesign(): ThinkingDesign {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThinkingDesign | null
    if (v && VALID_DESIGNS.includes(v)) return v
  } catch { /* noop */ }
  return 'orbits'
}

export function useThinkingDesign() {
  const [design, setDesignState] = useState<ThinkingDesign>(readDesign)

  const setDesign = useCallback((d: ThinkingDesign) => {
    setDesignState(d)
    try { localStorage.setItem(STORAGE_KEY, d) } catch { /* noop */ }
  }, [])

  return [design, setDesign] as const
}

// ─────────────────────────────────────────────────────────────────────────────
// Design 1: Ethereal Orbits
// Luminous particles tracing a lemniscate (figure-8) with staggered timing
// ─────────────────────────────────────────────────────────────────────────────
function EtherealOrbits() {
  return (
    <div className="thinking-orbits" aria-hidden="true">
      <svg viewBox="0 0 60 24" className="thinking-orbits__svg">
        {/* Glow filter */}
        <defs>
          <filter id="orb-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="orb-grad-1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orb-grad-2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.75 0.18 280)" stopOpacity="1" />
            <stop offset="100%" stopColor="oklch(0.75 0.18 280)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orb-grad-3" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.78 0.14 200)" stopOpacity="1" />
            <stop offset="100%" stopColor="oklch(0.78 0.14 200)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Faint lemniscate trace */}
        <path
          d="M30,12 C30,6 40,2 46,8 C52,14 42,22 30,12 C18,2 8,10 14,16 C20,22 30,18 30,12Z"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity="0.08"
          strokeWidth="0.5"
        />

        {/* Orb 1 — primary blue */}
        <circle r="2" filter="url(#orb-glow)" fill="url(#orb-grad-1)" className="thinking-orb thinking-orb--1">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            path="M30,12 C30,6 40,2 46,8 C52,14 42,22 30,12 C18,2 8,10 14,16 C20,22 30,18 30,12Z"
          />
        </circle>

        {/* Orb 2 — violet */}
        <circle r="1.6" filter="url(#orb-glow)" fill="url(#orb-grad-2)" className="thinking-orb thinking-orb--2">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            begin="-1s"
            path="M30,12 C30,6 40,2 46,8 C52,14 42,22 30,12 C18,2 8,10 14,16 C20,22 30,18 30,12Z"
          />
        </circle>

        {/* Orb 3 — cyan */}
        <circle r="1.3" filter="url(#orb-glow)" fill="url(#orb-grad-3)" className="thinking-orb thinking-orb--3">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            begin="-2s"
            path="M30,12 C30,6 40,2 46,8 C52,14 42,22 30,12 C18,2 8,10 14,16 C20,22 30,18 30,12Z"
          />
        </circle>
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Design 2: Morphing Waveform
// Fluid sine wave with shifting amplitude and phase, gradient stroke
// ─────────────────────────────────────────────────────────────────────────────
function MorphingWaveform() {
  return (
    <div className="thinking-wave" aria-hidden="true">
      <svg viewBox="0 0 80 24" className="thinking-wave__svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0" />
            <stop offset="20%" stopColor="var(--color-primary)" stopOpacity="0.7" />
            <stop offset="50%" stopColor="oklch(0.75 0.18 280)" stopOpacity="1" />
            <stop offset="80%" stopColor="var(--color-primary)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wave-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="oklch(0.78 0.14 200)" stopOpacity="0" />
            <stop offset="30%" stopColor="oklch(0.78 0.14 200)" stopOpacity="0.4" />
            <stop offset="70%" stopColor="oklch(0.72 0.16 260)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="oklch(0.78 0.14 200)" stopOpacity="0" />
          </linearGradient>
          <filter id="wave-blur">
            <feGaussianBlur stdDeviation="0.8" />
          </filter>
        </defs>

        {/* Background glow wave (blurred, slower) */}
        <path className="thinking-wave__path thinking-wave__path--bg" stroke="url(#wave-grad-2)" />

        {/* Primary wave */}
        <path className="thinking-wave__path thinking-wave__path--main" stroke="url(#wave-grad)" />

        {/* Bright core wave (thinner, sharper) */}
        <path className="thinking-wave__path thinking-wave__path--core" stroke="url(#wave-grad)" />
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Design 4: Ink Diffusion
// Dye blobs emanating upward in a half-circle from the input, swirling together
// via SVG feTurbulence displacement — slow, dreamy, organic mixing
// ─────────────────────────────────────────────────────────────────────────────
function InkDiffusion() {
  // The outer div uses a CSS mask-image (radial-gradient ellipse at bottom center)
  // to clip the ENTIRE rendered output into a semicircle that fades to transparent.
  // No SVG mask needed — the CSS mask handles the shape cleanly at the DOM level.
  return (
    <div className="thinking-diffusion" aria-hidden="true">
      <svg
        viewBox="0 0 400 200"
        className="thinking-diffusion__svg"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          {/* Turbulence for organic swirl distortion */}
          <filter id="ink-swirl" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.016"
              numOctaves="4"
              seed="2"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                values="0.012 0.016;0.020 0.012;0.010 0.022;0.012 0.016"
                dur="14s"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="45"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Swirling dye blobs — CSS mask on parent div handles the semicircle fade */}
        <g filter="url(#ink-swirl)">
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--1"
            cx="200" cy="170" rx="90" ry="60"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--2"
            cx="150" cy="160" rx="70" ry="50"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--3"
            cx="250" cy="165" rx="75" ry="45"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--4"
            cx="200" cy="180" rx="50" ry="35"
          />
        </g>
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Design 3: Neural Constellation
// Dots shift between random positions, connected by fading lines
// ─────────────────────────────────────────────────────────────────────────────
function NeuralConstellation() {
  return (
    <div className="thinking-neural" aria-hidden="true">
      <svg viewBox="0 0 70 20" className="thinking-neural__svg">
        <defs>
          <filter id="neural-glow">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connecting lines — animate opacity to simulate firing */}
        <line className="thinking-neural__line thinking-neural__line--1" x1="12" y1="10" x2="25" y2="6" />
        <line className="thinking-neural__line thinking-neural__line--2" x1="25" y1="6" x2="35" y2="14" />
        <line className="thinking-neural__line thinking-neural__line--3" x1="35" y1="14" x2="47" y2="8" />
        <line className="thinking-neural__line thinking-neural__line--4" x1="47" y1="8" x2="58" y2="12" />
        <line className="thinking-neural__line thinking-neural__line--5" x1="12" y1="10" x2="35" y2="14" />
        <line className="thinking-neural__line thinking-neural__line--6" x1="25" y1="6" x2="47" y2="8" />
        <line className="thinking-neural__line thinking-neural__line--7" x1="35" y1="14" x2="58" y2="12" />

        {/* Nodes */}
        <circle className="thinking-neural__node thinking-neural__node--1" cx="12" cy="10" r="2" filter="url(#neural-glow)" />
        <circle className="thinking-neural__node thinking-neural__node--2" cx="25" cy="6" r="1.7" filter="url(#neural-glow)" />
        <circle className="thinking-neural__node thinking-neural__node--3" cx="35" cy="14" r="2.2" filter="url(#neural-glow)" />
        <circle className="thinking-neural__node thinking-neural__node--4" cx="47" cy="8" r="1.5" filter="url(#neural-glow)" />
        <circle className="thinking-neural__node thinking-neural__node--5" cx="58" cy="12" r="1.8" filter="url(#neural-glow)" />

        {/* Pulse rings — expand and fade from each node on a cycle */}
        <circle className="thinking-neural__pulse thinking-neural__pulse--1" cx="12" cy="10" />
        <circle className="thinking-neural__pulse thinking-neural__pulse--2" cx="25" cy="6" />
        <circle className="thinking-neural__pulse thinking-neural__pulse--3" cx="35" cy="14" />
        <circle className="thinking-neural__pulse thinking-neural__pulse--4" cx="47" cy="8" />
        <circle className="thinking-neural__pulse thinking-neural__pulse--5" cx="58" cy="12" />
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported composite component
// ─────────────────────────────────────────────────────────────────────────────

interface ThinkingIndicatorProps {
  visible: boolean
  design?: ThinkingDesign
  className?: string
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
  visible,
  design = 'orbits',
  className,
}: ThinkingIndicatorProps) {
  const isDiffusion = design === 'diffusion'

  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 right-0 z-10 pointer-events-none',
        'transition-all duration-500 ease-out',
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-2',
        // Diffusion gets no background gradient — it IS the background effect
        !isDiffusion && 'bg-gradient-to-t from-background via-background/95 to-transparent',
        className,
      )}
    >
      {isDiffusion ? (
        <InkDiffusion />
      ) : (
        <div className="flex items-center justify-center px-4 py-2.5 max-w-3xl mx-auto">
          {design === 'orbits' && <EtherealOrbits />}
          {design === 'waveform' && <MorphingWaveform />}
          {design === 'constellation' && <NeuralConstellation />}
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Design picker (small inline toggle for the user to switch between designs)
// ─────────────────────────────────────────────────────────────────────────────

const DESIGN_META: { key: ThinkingDesign; label: string }[] = [
  { key: 'orbits', label: 'Orbits' },
  { key: 'waveform', label: 'Wave' },
  { key: 'constellation', label: 'Neural' },
  { key: 'diffusion', label: 'Ink' },
]

interface DesignPickerProps {
  value: ThinkingDesign
  onChange: (d: ThinkingDesign) => void
  className?: string
}

export function ThinkingDesignPicker({ value, onChange, className }: DesignPickerProps) {
  return (
    <div className={cn('flex items-center gap-1 rounded-md bg-muted/50 p-0.5', className)}>
      {DESIGN_META.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'px-2 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase transition-colors',
            key === value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
