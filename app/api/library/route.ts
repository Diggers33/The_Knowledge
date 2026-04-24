import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL    ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY   ?? 'placeholder-key'
)

// Fetch all rows by paging through PostgREST's 1000-row default cap
async function fetchAllDistinctDocs() {
  const PAGE = 1000
  const docMap: Record<string, any> = {}
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('rag_documents')
      .select('source_file, folder, rag_tier, rag_score, size_mb')
      .range(offset, offset + PAGE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data) {
      const key = row.source_file
      if (!docMap[key]) {
        docMap[key] = { ...row, chunk_count: 0 }
      }
      docMap[key].chunk_count++
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  return docMap
}

export async function GET() {
  try {
    const docMap = await fetchAllDistinctDocs()
    const docs = Object.values(docMap).sort((a: any, b: any) => b.rag_score - a.rag_score)

    const tiers: Record<string, number> = {}
    let totalChunks = 0
    for (const d of docs) {
      tiers[d.rag_tier] = (tiers[d.rag_tier] || 0) + 1
      totalChunks += d.chunk_count
    }

    return NextResponse.json({
      docs,
      stats: {
        total_docs: docs.length,
        total_chunks: totalChunks,
        tiers
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
