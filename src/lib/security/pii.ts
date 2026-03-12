export type MemoryPiiLayer = 'platform' | 'niche' | 'business' | 'agent'

export interface PiiPolicyResult {
  content: string
  redacted: boolean
  blocked: boolean
}

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1?\s*[-.]?\s*)?(\(?\d{3}\)?)\s*[-.]?\s*(\d{3})\s*[-.]?\s*(\d{4})\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ipAddress: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
} as const

function replacePattern(content: string, pattern: RegExp, replacement: string): string {
  pattern.lastIndex = 0
  return content.replace(pattern, replacement)
}

export function containsPii(content: string): boolean {
  for (const pattern of Object.values(PII_PATTERNS)) {
    pattern.lastIndex = 0
    if (pattern.test(content)) {
      return true
    }
  }
  return false
}

export function redactPii(content: string): string {
  let redacted = content
  redacted = replacePattern(redacted, PII_PATTERNS.email, '[REDACTED_EMAIL]')
  redacted = replacePattern(redacted, PII_PATTERNS.phone, '[REDACTED_PHONE]')
  redacted = replacePattern(redacted, PII_PATTERNS.ssn, '[REDACTED_SSN]')
  redacted = replacePattern(redacted, PII_PATTERNS.creditCard, '[REDACTED_CARD]')
  redacted = replacePattern(redacted, PII_PATTERNS.ipAddress, '[REDACTED_IP]')
  return redacted
}

export function applyPiiLayerPolicy(content: string, layer: MemoryPiiLayer): PiiPolicyResult {
  if (!containsPii(content)) {
    return { content, redacted: false, blocked: false }
  }

  if (layer === 'platform') {
    return { content, redacted: false, blocked: true }
  }

  if (layer === 'niche' || layer === 'agent') {
    return {
      content: redactPii(content),
      redacted: true,
      blocked: false,
    }
  }

  return { content, redacted: false, blocked: false }
}
