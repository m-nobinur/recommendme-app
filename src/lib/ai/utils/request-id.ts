/**
 * Request ID utilities for tracing and correlation
 */

/**
 * Generate a unique request ID
 * Uses crypto.randomUUID for browser/Node.js 19+
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Create a child request ID for nested operations
 */
export function createChildRequestId(parentId: string, operation: string): string {
  return `${parentId}:${operation}`
}

/**
 * Extract base request ID (removes child operation suffixes)
 */
export function getBaseRequestId(requestId: string): string {
  return requestId.split(':')[0]
}
