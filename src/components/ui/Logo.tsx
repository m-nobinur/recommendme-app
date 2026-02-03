import type React from 'react'
import { memo } from 'react'

interface LogoProps {
  className?: string
  size?: number
  variant?: 'color' | 'monochrome'
}

/**
 * Reme Official Logo - "The Neural Spark"
 * A professional, geometrically crafted icon representing AI assistance, clarity, and connection.
 */
export const Logo: React.FC<LogoProps> = memo(({ className, size = 24, variant = 'color' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient
          id="reme-gradient"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F59E0B" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient
          id="reme-glow"
          x1="12"
          y1="5"
          x2="12"
          y2="19"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F59E0B" stopOpacity="0.8" />
          <stop offset="1" stopColor="#EA580C" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      <g
        stroke={variant === 'color' ? 'url(#reme-gradient)' : 'currentColor'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Core Node */}
        <path d="M12 3V5" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="7"
          r="2"
          fill={variant === 'color' ? 'url(#reme-gradient)' : 'currentColor'}
          stroke="none"
        />

        {/* Connection Paths */}
        <path d="M12 9V13" />

        {/* Left Side */}
        <path d="M12 13L8 16" />
        <circle
          cx="7"
          cy="17"
          r="1.5"
          stroke="none"
          fill={variant === 'color' ? '#F59E0B' : 'currentColor'}
          opacity="0.9"
        />

        {/* Right Side */}
        <path d="M12 13L16 16" />
        <circle
          cx="17"
          cy="17"
          r="1.5"
          stroke="none"
          fill={variant === 'color' ? '#EA580C' : 'currentColor'}
          opacity="0.9"
        />

        {/* Orbit loops */}
        <path
          d="M4.5 10C4.5 7 7.5 4 11 4"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
        <path
          d="M19.5 14C19.5 17 16.5 20 13 20"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
      </g>
    </svg>
  )
})

Logo.displayName = 'Logo'
