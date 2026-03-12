import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatContext } from './contextFormatter'

describe('contextFormatter cache-friendly ordering', () => {
  it('places stable sections before tenant-specific sections', () => {
    const formatted = formatContext({
      platform: [
        { document: { _id: 'platform_1', content: 'Always confirm before invoicing.' } } as any,
      ],
      niche: [
        { document: { _id: 'niche_1', content: 'Wedding clients prefer weekend slots.' } } as any,
      ],
      business: [
        {
          document: { _id: 'business_1', type: 'fact', content: 'Sarah prefers afternoons.' },
        } as any,
      ],
      agent: [
        { document: { _id: 'agent_1', content: 'Follow-up after 48 hours works best.' } } as any,
      ],
    })

    const bestPracticesIdx = formatted.text.indexOf('**Best practices:**')
    const industryIdx = formatted.text.indexOf('**Industry knowledge:**')
    const customerIdx = formatted.text.indexOf('**About your clients:**')
    const learnedIdx = formatted.text.indexOf("**Things you've learned:**")

    assert.ok(bestPracticesIdx >= 0)
    assert.ok(industryIdx > bestPracticesIdx)
    assert.ok(customerIdx > industryIdx)
    assert.ok(learnedIdx > customerIdx)
  })
})
