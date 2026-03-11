export type TenantIsolationErrorCode = 'org_access_denied' | 'org_unauthenticated_access'

const ORG_ACCESS_DENIED_MESSAGE = 'Access denied for organization'
const ORG_UNAUTHENTICATED_MESSAGE = 'Unauthenticated organization access is not allowed'
const ORG_ACCESS_DENIED_CODE = 'ORG_ACCESS_DENIED'
const ORG_UNAUTHENTICATED_CODE = 'ORG_UNAUTHENTICATED'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const candidate = error as {
    code?: unknown
    data?: { code?: unknown }
  }

  if (typeof candidate.code === 'string') {
    return candidate.code
  }

  if (candidate.data && typeof candidate.data.code === 'string') {
    return candidate.data.code
  }

  return null
}

export function classifyTenantIsolationError(error: unknown): TenantIsolationErrorCode | null {
  const code = getErrorCode(error)
  if (code === ORG_ACCESS_DENIED_CODE) {
    return 'org_access_denied'
  }
  if (code === ORG_UNAUTHENTICATED_CODE) {
    return 'org_unauthenticated_access'
  }

  const message = getErrorMessage(error)
  if (message.includes(ORG_ACCESS_DENIED_MESSAGE)) {
    return 'org_access_denied'
  }
  if (message.includes(ORG_UNAUTHENTICATED_MESSAGE)) {
    return 'org_unauthenticated_access'
  }
  return null
}

export function isTenantIsolationError(error: unknown): boolean {
  return classifyTenantIsolationError(error) !== null
}
