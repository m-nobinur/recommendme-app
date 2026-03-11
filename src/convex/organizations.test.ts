import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildOrgSlugBase,
  createOrganizationForSignup,
  getOrganization,
  updateOrganizationSettings,
} from './organizations'

describe('buildOrgSlugBase', () => {
  it('extracts email prefix and normalizes', () => {
    assert.equal(buildOrgSlugBase('john.doe@example.com'), 'john-doe')
  })

  it('lowercases the prefix', () => {
    assert.equal(buildOrgSlugBase('John.Smith@example.com'), 'john-smith')
  })

  it('strips non-alphanumeric characters', () => {
    assert.equal(buildOrgSlugBase('user+tag@example.com'), 'user-tag')
  })

  it('collapses consecutive dashes', () => {
    assert.equal(buildOrgSlugBase('a--b---c@example.com'), 'a-b-c')
  })

  it('trims leading/trailing dashes', () => {
    assert.equal(buildOrgSlugBase('-user-@example.com'), 'user')
  })

  it('truncates to 30 characters', () => {
    const long = `${'a'.repeat(50)}@example.com`
    assert.equal(buildOrgSlugBase(long).length, 30)
  })

  it('returns "workspace" for empty prefix', () => {
    assert.equal(buildOrgSlugBase('@example.com'), 'workspace')
  })

  it('returns "workspace" for prefix that normalizes to empty', () => {
    assert.equal(buildOrgSlugBase('---@example.com'), 'workspace')
  })
})

describe('createOrganizationForSignup', () => {
  it('creates org with unique slug on first attempt', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => null,
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'org_1'
        },
      },
    }

    const id = await createOrganizationForSignup(ctx as any, {
      name: "Alice's Workspace",
      userEmail: 'alice@example.com',
    })

    assert.equal(id, 'org_1')
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].slug, 'alice')
    assert.equal(inserted[0].name, "Alice's Workspace")
    assert.equal(typeof inserted[0].createdAt, 'number')
  })

  it('appends counter suffix on slug collision', async () => {
    const inserted: Array<Record<string, unknown>> = []
    let queryCount = 0

    const ctx = {
      db: {
        query: () => ({
          withIndex: (_name: string, _build: any) => ({
            first: async () => {
              queryCount++
              if (queryCount <= 2) return { _id: 'existing_org' }
              return null
            },
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'org_new'
        },
      },
    }

    const id = await createOrganizationForSignup(ctx as any, {
      name: "Bob's Workspace",
      userEmail: 'bob@example.com',
    })

    assert.equal(id, 'org_new')
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].slug, 'bob-2')
    assert.equal(queryCount, 3)
  })

  it('handles multiple collisions with increasing counter', async () => {
    const inserted: Array<Record<string, unknown>> = []
    let queryCount = 0

    const ctx = {
      db: {
        query: () => ({
          withIndex: (_name: string, _build: any) => ({
            first: async () => {
              queryCount++
              if (queryCount <= 5) return { _id: 'existing' }
              return null
            },
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'org_new'
        },
      },
    }

    await createOrganizationForSignup(ctx as any, {
      name: 'Workspace',
      userEmail: 'test@example.com',
    })

    assert.equal(inserted[0].slug, 'test-5')
  })

  it('includes default settings in created org', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => null,
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'org_1'
        },
      },
    }

    await createOrganizationForSignup(ctx as any, {
      name: 'Test Workspace',
      userEmail: 'admin@corp.com',
    })

    const settings = inserted[0].settings as Record<string, string>
    assert.equal(settings.defaultAiProvider, 'openrouter')
    assert.equal(settings.modelTier, 'smart')
  })

  it('uses slug hint to reduce signup slug collisions', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => null,
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'org_1'
        },
      },
    }

    await createOrganizationForSignup(ctx as any, {
      name: "Alice's Workspace",
      userEmail: 'alice@example.com',
      slugHint: 'user_ABC-123',
    })

    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].slug, 'alice-userabc123')
  })
})

describe('organization auth guards', () => {
  it('blocks unauthenticated production reads', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalBypass = process.env.DISABLE_AUTH_IN_DEV
    process.env.NODE_ENV = 'production'
    delete process.env.DISABLE_AUTH_IN_DEV

    try {
      const ctx = {
        db: {
          get: async () => ({ _id: 'org_1', name: 'Org' }),
        },
      }

      await assert.rejects(() => (getOrganization as any)._handler(ctx, { id: 'org_1' }))
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      process.env.DISABLE_AUTH_IN_DEV = originalBypass
    }
  })

  it('blocks unauthenticated production writes', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalBypass = process.env.DISABLE_AUTH_IN_DEV
    process.env.NODE_ENV = 'production'
    delete process.env.DISABLE_AUTH_IN_DEV

    try {
      const ctx = {
        db: {
          get: async () => ({ _id: 'org_1', settings: {} }),
          patch: async () => {},
        },
      }

      await assert.rejects(() =>
        (updateOrganizationSettings as any)._handler(ctx, {
          id: 'org_1',
          settings: { timezone: 'UTC' },
        })
      )
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      process.env.DISABLE_AUTH_IN_DEV = originalBypass
    }
  })
})
