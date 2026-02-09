import { memo } from 'react'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Ink Diffusion Thinking Indicator
// Dye blobs emanating upward in a semicircle from the input, swirling together
// via SVG feTurbulence displacement — slow, dreamy, organic mixing.
// A subtle "Thinking" label floats at the top of the dome.
// ─────────────────────────────────────────────────────────────────────────────

function InkDiffusion() {
  return (
    <div className="thinking-diffusion" aria-hidden="true">
      <svg
        viewBox="0 0 400 200"
        className="thinking-diffusion__svg"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
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
              scale="28"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <g filter="url(#ink-swirl)">
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--1"
            cx="200" cy="175" rx="55" ry="35"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--2"
            cx="175" cy="170" rx="45" ry="30"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--3"
            cx="225" cy="172" rx="48" ry="28"
          />
          <ellipse className="thinking-diffusion__blob thinking-diffusion__blob--4"
            cx="200" cy="180" rx="35" ry="22"
          />
        </g>
      </svg>

      {/* Subtle "Thinking" label floating at the crest of the dome */}
      <span className="thinking-diffusion__label">Thinking</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported component
// ─────────────────────────────────────────────────────────────────────────────

interface ThinkingIndicatorProps {
  visible: boolean
  className?: string
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
  visible,
  className,
}: ThinkingIndicatorProps) {
  // Asymmetric transitions: fast fade-in (600ms), slow fade-out (2.5s).
  // The slow exit means if thinking resumes mid-fade, the animation
  // smoothly reverses back up instead of flashing off/on.
  return (
    <div
      className={cn(
        'absolute bottom-4 left-0 right-0 z-10 pointer-events-none',
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3',
        className,
      )}
      style={{
        transition: visible
          ? 'opacity 600ms ease-out, transform 600ms ease-out'
          : 'opacity 2.5s ease-in-out, transform 2.5s ease-in-out',
      }}
    >
      <InkDiffusion />
    </div>
  )
})
