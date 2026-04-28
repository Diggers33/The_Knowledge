import { describe, it, expect, beforeEach } from 'vitest'
import { cacheProposal, getProposal } from '../lib/server/proposal-cache'
import type { ProposalDocument } from '../lib/evaluator/types'

const sampleDoc: ProposalDocument = {
  text: 'sample text',
  tables: [
    {
      pageNumber: 1,
      header: ['A', 'B'],
      rows: [{ cells: ['1', '2'] }],
      kind: 'unknown',
      bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
    },
  ],
  figures: [],
  meta: { pageCount: 1, extractionVersion: 'v2', isDocx: false },
}

beforeEach(() => {
  // Ensure no KV env so tests always hit in-memory path
  delete process.env.KV_REST_API_URL
  // Clear the global cache between tests
  const g = globalThis as any
  if (g.__proposalCache) g.__proposalCache.clear()
})

describe('proposal-cache hot-fix', () => {
  it('round-trips a proposal through cache and back', async () => {
    const docId = await cacheProposal(sampleDoc)
    expect(docId).toMatch(/^[0-9a-f-]{6,}/)
    const got = await getProposal(docId)
    expect(got?.text).toBe('sample text')
    expect(got?.tables.length).toBe(1)
  })

  it('returns null on missing docId', async () => {
    expect(await getProposal('does-not-exist')).toBeNull()
    expect(await getProposal('')).toBeNull()
  })

  it('expires after TTL (in-memory path)', async () => {
    const docId = await cacheProposal(sampleDoc)
    const g = globalThis as any
    g.__proposalCache.get(docId).expiresAt = Date.now() - 1
    expect(await getProposal(docId)).toBeNull()
  })

  it('hard-caps at 20 entries to prevent memory blowup', async () => {
    for (let i = 0; i < 25; i++) await cacheProposal(sampleDoc)
    const g = globalThis as any
    expect(g.__proposalCache.size).toBeLessThanOrEqual(20)
  })

  it('docId is unique across multiple stores', async () => {
    const id1 = await cacheProposal(sampleDoc)
    const id2 = await cacheProposal(sampleDoc)
    expect(id1).not.toBe(id2)
  })

  it('retrieved doc is structurally identical to stored doc', async () => {
    const docId = await cacheProposal(sampleDoc)
    const got = await getProposal(docId)
    expect(got?.tables[0].kind).toBe('unknown')
    expect(got?.meta.extractionVersion).toBe('v2')
    expect(got?.meta.isDocx).toBe(false)
  })
})
