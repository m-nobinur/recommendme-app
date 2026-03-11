import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyTenantIsolationError, isTenantIsolationError } from './tenantIsolation'

describe('tenant isolation error classification', () => {
  it('classifies structured organization access denial codes', () => {
    const byCode = classifyTenantIsolationError({
      code: 'ORG_ACCESS_DENIED',
      message: 'irrelevant',
    })
    const byNestedCode = classifyTenantIsolationError({
      data: { code: 'ORG_UNAUTHENTICATED' },
    })

    assert.equal(byCode, 'org_access_denied')
    assert.equal(byNestedCode, 'org_unauthenticated_access')
  })

  it('classifies organization access denial errors', () => {
    const code = classifyTenantIsolationError(new Error('Access denied for organization'))
    assert.equal(code, 'org_access_denied')
    assert.equal(isTenantIsolationError(new Error('Access denied for organization')), true)
  })

  it('classifies unauthenticated organization access errors', () => {
    const code = classifyTenantIsolationError(
      new Error('Unauthenticated organization access is not allowed')
    )
    assert.equal(code, 'org_unauthenticated_access')
  })

  it('returns null for non-tenant errors', () => {
    const code = classifyTenantIsolationError(new Error('Some unrelated error'))
    assert.equal(code, null)
    assert.equal(isTenantIsolationError(new Error('Some unrelated error')), false)
  })
})
