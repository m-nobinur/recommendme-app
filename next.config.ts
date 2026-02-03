import path from 'node:path'
import type { NextConfig } from 'next'

// Absolute path to the project directory
const projectRoot = path.resolve(__dirname)

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Set the root directory for output file tracing
  outputFileTracingRoot: projectRoot,

  // Experimental features
  experimental: {
    // Server actions with increased body size
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Enable typed routes for type-safe navigation
  typedRoutes: true,

  // Turbopack configuration (now top-level in Next.js 16)
  turbopack: {
    root: projectRoot,
  },

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },

  // Image optimization with modern formats
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Security headers with enhanced CSP
  async headers() {
    // Define CSP directives for security
    const cspDirectives = [
      "default-src 'self'",
      // Scripts: self + inline for Next.js hydration + eval for dev mode
      process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      // Styles: self + inline for styled-jsx/tailwind
      "style-src 'self' 'unsafe-inline'",
      // Images: self + data URIs + external images
      "img-src 'self' data: blob: https:",
      // Fonts: self + Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Connect: self + Convex + AI providers
      "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://api.openai.com https://generativelanguage.googleapis.com",
      // Frame ancestors: prevent embedding
      "frame-ancestors 'none'",
      // Base URI: self only
      "base-uri 'self'",
      // Form action: self only
      "form-action 'self'",
      // Upgrade insecure requests in production
      ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
    ]

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Content-Security-Policy',
            value: cspDirectives.join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ]
  },
}

export default nextConfig
