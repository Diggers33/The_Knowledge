import { NextRequest, NextResponse } from 'next/server'
import { cacheProposal } from '@/lib/server/proposal-cache'
import type { ProposalDocument } from '@/lib/evaluator/types'

export const maxDuration = 30
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { proposal: ProposalDocument }
    if (!body.proposal || typeof body.proposal.text !== 'string') {
      return NextResponse.json({ error: 'invalid_proposal' }, { status: 400 })
    }
    const MAX_TABLES = 50
    const MAX_FIGURES = 8
    const trimmed: ProposalDocument = {
      ...body.proposal,
      tables: (body.proposal.tables ?? [])
        .filter(t => t.rows.length > 0)
        .sort((a, b) => b.rows.length - a.rows.length)
        .slice(0, MAX_TABLES),
      figures: (body.proposal.figures ?? []).slice(0, MAX_FIGURES),
    }
    const docId = await cacheProposal(trimmed)
    return NextResponse.json({
      docId,
      stats: {
        textLen: trimmed.text.length,
        tableCount: trimmed.tables.length,
        figureCount: trimmed.figures.length,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
