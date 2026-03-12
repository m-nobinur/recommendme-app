import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyMemoryLayerPiiPolicy, containsPii, redactPiiContent } from './memoryValidation'

describe('convex memoryValidation PII helpers', () => {
  it('detects PII content', () => {
    assert.equal(containsPii('Customer email is jane@example.com'), true)
    assert.equal(containsPii('No personal info in this content'), false)
  })

  it('redacts PII content for warning layers', () => {
    const redacted = redactPiiContent('Call me at 415-555-0101 or jane@example.com')
    assert.ok(redacted.includes('[REDACTED_PHONE]'))
    assert.ok(redacted.includes('[REDACTED_EMAIL]'))
  })
})

describe('convex memoryValidation layer policy', () => {
  const piiText = 'Customer SSN 123-45-6789'

  it('throws on platform PII', () => {
    assert.throws(() => applyMemoryLayerPiiPolicy(piiText, 'platform'))
  })

  it('redacts niche and agent PII', () => {
    const niche = applyMemoryLayerPiiPolicy(piiText, 'niche')
    const agent = applyMemoryLayerPiiPolicy(piiText, 'agent')
    assert.equal(niche.redacted, true)
    assert.equal(agent.redacted, true)
    assert.ok(niche.content.includes('[REDACTED_SSN]'))
    assert.ok(agent.content.includes('[REDACTED_SSN]'))
  })

  it('allows business layer unchanged', () => {
    const business = applyMemoryLayerPiiPolicy(piiText, 'business')
    assert.equal(business.redacted, false)
    assert.equal(business.content, piiText)
  })
})
