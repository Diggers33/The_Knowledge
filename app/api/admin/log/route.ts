import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL    ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY   ?? 'placeholder-key'
)

export async function GET() {
  try {
    const { data } = await supabase
      .from('rag_ingestion_log')
      .select('*')
      .order('processed_at', { ascending: false })

    const log = data || []
    const stats = {
      done: log.filter(l => l.status === 'done').length,
      failed: log.filter(l => l.status === 'failed').length,
      skipped: log.filter(l => l.status === 'skipped').length,
      total_chunks: log.reduce((sum, l) => sum + (l.chunks_inserted || 0), 0)
    }

    return NextResponse.json({ log, stats })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
