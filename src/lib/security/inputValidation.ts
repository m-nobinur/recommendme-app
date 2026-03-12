export interface InputValidationResult {
  safe: boolean
  threats: string[]
}

export interface UserMessageInput {
  role: string
  content: string
}

const MAX_MESSAGE_LENGTH = 10_000

function hasSuspiciousControlCharacters(content: string): boolean {
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return true
    }
  }

  return false
}

function stripControlCharacters(content: string): string {
  let sanitized = ''
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const code = content.charCodeAt(i)
    if ((code >= 0 && code <= 31) || code === 127) {
      continue
    }
    sanitized += char
  }
  return sanitized
}

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /ignore\s+(all\s+)?previous\s+(instructions|prompts|context)/i,
    label: 'prompt_override_attempt',
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/i,
    label: 'prompt_override_attempt',
  },
  {
    pattern: /forget\s+(everything|all|your)\s*(instructions|rules|guidelines|memories)?/i,
    label: 'memory_clearing_attempt',
  },
  {
    pattern: /delete\s+all\s+(memories|data|information|records)/i,
    label: 'memory_clearing_attempt',
  },
  {
    pattern: /clear\s+(all\s+)?(your\s+)?(memory|memories|context)/i,
    label: 'memory_clearing_attempt',
  },
  {
    pattern: /^system\s*:/im,
    label: 'system_prefix_injection',
  },
  {
    pattern: /\[system\]/i,
    label: 'system_prefix_injection',
  },
  {
    pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i,
    label: 'role_reassignment',
  },
  {
    pattern: /pretend\s+(to\s+be|you\s+are)\s+/i,
    label: 'role_reassignment',
  },
  {
    pattern: /act\s+as\s+(a|an|the|my)\s+different/i,
    label: 'role_reassignment',
  },
  {
    pattern: /new\s+persona\s*:/i,
    label: 'role_reassignment',
  },
  {
    pattern: /bypass\s+(security|filter|safety|restrictions)/i,
    label: 'security_bypass_attempt',
  },
  {
    pattern: /override\s+(security|safety|rules|restrictions)/i,
    label: 'security_bypass_attempt',
  },
  {
    pattern: /jailbreak/i,
    label: 'security_bypass_attempt',
  },
  {
    pattern: /reveal\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
    label: 'prompt_extraction_attempt',
  },
  {
    pattern: /show\s+me\s+your\s+(system\s+)?(prompt|instructions)/i,
    label: 'prompt_extraction_attempt',
  },
  {
    pattern: /what\s+are\s+your\s+(hidden|secret|internal)\s+(instructions|rules|prompts)/i,
    label: 'prompt_extraction_attempt',
  },
  {
    pattern: /(<script|javascript:|on\w+=|<iframe|<object)/i,
    label: 'xss_attempt',
  },
  {
    pattern: /(;\s*DROP\s+TABLE|;\s*DELETE\s+FROM|UNION\s+SELECT|--\s*$)/i,
    label: 'sql_injection_attempt',
  },
]

/**
 * Validate chat input for prompt injection, content length, and encoding issues.
 * Returns a result indicating whether the input is safe and any detected threats.
 */
export function validateChatInput(content: string): InputValidationResult {
  const threats: string[] = []

  if (content.length > MAX_MESSAGE_LENGTH) {
    threats.push(`content_too_long:${content.length}`)
  }

  if (hasSuspiciousControlCharacters(content)) {
    threats.push('suspicious_control_characters')
  }

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      threats.push(label)
    }
  }

  return {
    safe: threats.length === 0,
    threats: [...new Set(threats)],
  }
}

export function sanitizeForLogging(content: string, maxLength = 500): string {
  return stripControlCharacters(content).slice(0, maxLength)
}

export function validateMessagesInput(messages: UserMessageInput[]): InputValidationResult {
  const threats = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'user') continue
    const result = validateChatInput(message.content)
    for (const threat of result.threats) {
      threats.add(threat)
    }
  }

  return {
    safe: threats.size === 0,
    threats: [...threats],
  }
}
