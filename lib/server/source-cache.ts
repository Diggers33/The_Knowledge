export interface SourceTable {
  title?: string
  rows: string[][]
  sourceFile: string
  sheetName?: string
}

export interface SourceFile {
  fileName: string
  category: 'measurements' | 'report' | 'spec' | 'reference' | 'other'
  extractedText: string
  tables: SourceTable[]
  wordCount: number
  pageCount?: number
}

export interface SourceDoc {
  sourceDocId: string
  projectCode: string
  deliverableRef: string
  files: SourceFile[]
  createdAt: number
}

interface CacheEntry {
  doc: SourceDoc
  expiresAt: number
}

const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 30
const MAX_TOTAL_BYTES = 6 * 1024 * 1024  // 6 MB per doc post-trim

const g = globalThis as unknown as { __sourceCache?: Map<string, CacheEntry> }
g.__sourceCache = g.__sourceCache ?? new Map<string, CacheEntry>()
const memCache = g.__sourceCache

async function getKv() {
  if (!process.env.KV_REST_API_URL) return null
  try {
    const mod = await import('@vercel/kv' as any)
    return mod.kv ?? null
  } catch {
    return null
  }
}

function trimDoc(doc: SourceDoc): SourceDoc {
  const MAX_TEXT_PER_FILE = 200 * 1024  // 200 KB
  const MAX_TABLES = 50

  let files = doc.files.map(f => ({
    ...f,
    extractedText: f.extractedText.length > MAX_TEXT_PER_FILE
      ? trimByParagraphs(f.extractedText, MAX_TEXT_PER_FILE)
      : f.extractedText,
    tables: f.tables
      .sort((a, b) => b.rows.length - a.rows.length)
      .slice(0, MAX_TABLES),
  }))

  // If still over 6 MB, drop lower-priority categories
  const encode = (d: SourceDoc) => JSON.stringify(d).length
  const priority: SourceFile['category'][] = ['measurements', 'report', 'spec', 'other', 'reference']
  for (const dropCat of ['reference', 'other'] as const) {
    if (encode({ ...doc, files }) <= MAX_TOTAL_BYTES) break
    files = files.filter(f => f.category !== dropCat)
  }
  // Final fallback: truncate extractedText further
  if (encode({ ...doc, files }) > MAX_TOTAL_BYTES) {
    files = files.map(f => ({
      ...f,
      extractedText: trimByParagraphs(f.extractedText, 100 * 1024),
    }))
  }

  return { ...doc, files }
}

function trimByParagraphs(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const paras = text.split(/\n\n+/)
  const kept: string[] = []
  let size = 0
  for (const p of paras) {
    const b = Buffer.byteLength(p)
    if (size + b > maxBytes) break
    kept.push(p)
    size += b
  }
  return kept.join('\n\n')
}

function sweepMemCache(): void {
  const now = Date.now()
  for (const [id, entry] of memCache.entries()) {
    if (entry.expiresAt < now) memCache.delete(id)
  }
  if (memCache.size > MAX_ENTRIES) {
    const oldest = [...memCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    for (let i = 0; i < memCache.size - MAX_ENTRIES; i++) memCache.delete(oldest[i][0])
  }
}

export async function putSource(doc: SourceDoc): Promise<void> {
  const trimmed = trimDoc(doc)
  const kv = await getKv()
  if (kv) {
    await kv.set(`source:${doc.sourceDocId}`, trimmed, { ex: 30 * 60 })
  } else {
    memCache.set(doc.sourceDocId, { doc: trimmed, expiresAt: Date.now() + TTL_MS })
    sweepMemCache()
  }
}

export async function getSource(sourceDocId: string): Promise<SourceDoc | null> {
  if (!sourceDocId) return null
  const kv = await getKv()
  if (kv) {
    const doc = await kv.get(`source:${sourceDocId}`) as SourceDoc | null
    return doc ?? null
  }
  const entry = memCache.get(sourceDocId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memCache.delete(sourceDocId)
    return null
  }
  return entry.doc
}

export async function deleteFileFromSource(sourceDocId: string, fileName: string): Promise<SourceDoc | null> {
  const doc = await getSource(sourceDocId)
  if (!doc) return null
  const updated: SourceDoc = { ...doc, files: doc.files.filter(f => f.fileName !== fileName) }
  await putSource(updated)
  return updated
}
