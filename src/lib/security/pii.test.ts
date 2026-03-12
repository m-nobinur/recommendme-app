import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyPiiLayerPolicy, containsPii, redactPii } from './pii'

describe('security pii detection', () => {
  it('detects common PII patterns', () => {
    assert.equal(containsPii('Email me at sara@example.com'), true)
    assert.equal(containsPii('Call me at 415-555-0101'), true)
    assert.equal(containsPii('No personal info here'), false)
  })
})

describe('security pii redaction', () => {
  it('redacts sensitive tokens with deterministic markers', () => {
    const text =
      'Contact sara@example.com, call 415-555-0101, card 4111 1111 1111 1111, ip 192.168.0.12'
    const redacted = redactPii(text)
    assert.ok(redacted.includes('[REDACTED_EMAIL]'))
    assert.ok(redacted.includes('[REDACTED_PHONE]'))
    assert.ok(redacted.includes('[REDACTED_CARD]'))
    assert.ok(redacted.includes('[REDACTED_IP]'))
  })
})

describe('security pii layer policy', () => {
  const piiText = 'Reach me at sara@example.com'

  it('blocks platform content with PII', () => {
    const result = applyPiiLayerPolicy(piiText, 'platform')
    assert.equal(result.blocked, true)
    assert.equal(result.redacted, false)
  })

  it('redacts niche and agent content with PII', () => {
    const nicheResult = applyPiiLayerPolicy(piiText, 'niche')
    const agentResult = applyPiiLayerPolicy(piiText, 'agent')

    assert.equal(nicheResult.blocked, false)
    assert.equal(nicheResult.redacted, true)
    assert.ok(nicheResult.content.includes('[REDACTED_EMAIL]'))

    assert.equal(agentResult.blocked, false)
    assert.equal(agentResult.redacted, true)
    assert.ok(agentResult.content.includes('[REDACTED_EMAIL]'))
  })

  it('allows business content with PII unchanged', () => {
    const result = applyPiiLayerPolicy(piiText, 'business')
    assert.equal(result.blocked, false)
    assert.equal(result.redacted, false)
    assert.equal(result.content, piiText)
  })
})
