import type { ProposalDocument } from '@/lib/evaluator/types'

interface CacheEntry {
  doc: ProposalDocument
  expiresAt: number
}

const TTL_MS = 30 * 60 * 1000

const g = globalThis as unknown as { __proposalCache?: Map<string, CacheEntry> }
g.__proposalCache = g.__proposalCache ?? new Map<string, CacheEntry>()
const memCache = g.__proposalCache

async function getKv(): Promise<{ get: (key: string) => Promise<unknown>; set: (key: string, val: unknown, opts: { ex: number }) => Promise<void> } | null> {
  if (!process.env.KV_REST_API_URL) return null
  try {
    // @vercel/kv is an optional peer dep — only present when KV is provisioned
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('@vercel/kv' as any)
    return mod.kv ?? null
  } catch {
    return null
  }
}

export async function cacheProposal(doc: ProposalDocument): Promise<string> {
  const docId = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string
  const kv = await getKv()
  if (kv) {
    await kv.set(`proposal:${docId}`, doc, { ex: 30 * 60 })
  } else {
    memCache.set(docId, { doc, expiresAt: Date.now() + TTL_MS })
    sweepMemCache()
  }
  return docId
}

export async function getProposal(docId: string): Promise<ProposalDocument | null> {
  if (!docId) return null
  const kv = await getKv()
  if (kv) {
    const doc = await kv.get(`proposal:${docId}`) as ProposalDocument | null
    return doc ?? null
  }
  const entry = memCache.get(docId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memCache.delete(docId)
    return null
  }
  return entry.doc
}

function sweepMemCache(): void {
  const now = Date.now()
  for (const [id, entry] of memCache.entries()) {
    if (entry.expiresAt < now) memCache.delete(id)
  }
  const HARD_CAP = 20
  if (memCache.size > HARD_CAP) {
    const oldest = [...memCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    for (let i = 0; i < memCache.size - HARD_CAP; i++) memCache.delete(oldest[i][0])
  }
}
