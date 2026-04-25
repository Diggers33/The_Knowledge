import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET — list current user's drafts (metadata only, no data blob)
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceClient()
    const { data, error } = await service
      .from('proposal_drafts')
      .select('id, name, acronym, call_id, phase, sections_complete, updated_at, created_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST — create or update a draft
// Body: { id?, name, acronym?, call_id?, phase?, sections_complete?, data }
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id, name, acronym, call_id, phase, sections_complete, data } = body

    if (!data) return NextResponse.json({ error: 'data is required' }, { status: 400 })

    const service = createServiceClient()

    if (id) {
      // Verify ownership before update
      const { data: existing } = await service
        .from('proposal_drafts')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const { data: updated, error } = await service
        .from('proposal_drafts')
        .update({ name: name || 'Untitled Draft', acronym, call_id, phase, sections_complete: sections_complete ?? 0, data })
        .eq('id', id)
        .select('id, updated_at')
        .single()

      if (error) throw error
      return NextResponse.json(updated)
    } else {
      // Create new
      const { data: created, error } = await service
        .from('proposal_drafts')
        .insert({ user_id: user.id, name: name || 'Untitled Draft', acronym, call_id, phase, sections_complete: sections_complete ?? 0, data })
        .select('id, updated_at')
        .single()

      if (error) throw error
      return NextResponse.json(created, { status: 201 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
