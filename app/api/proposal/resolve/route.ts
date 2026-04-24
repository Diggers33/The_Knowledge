/**
 * IRIS KB — Call Resolver
 *
 * POST { callText }
 *   → ResolvedCall (non-streaming, fast)
 *
 * Tries EU F&T API, falls back to Tavily, falls back to raw text parsing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { detectTemplate } from '@/lib/proposal-templates'
import type { ResolvedCall } from '@/lib/proposal-types'

// ─── EU F&T API ───────────────────────────────────────────────────────────────

function expandCallId(normalized: string): string[] {
  const parts = normalized.split('-')
  if (parts.some(p => /^20\d{2}$/.test(p))) return []
  if (parts.length < 3) return []
  return ['2026', '2025', '2027', '2024'].map(
    y => [parts[0], parts[1], y, ...parts.slice(2)].join('-')
  )
}

async function fetchFromEUFT(callId: string): Promise<{ title: string; text: string } | null> {
  const normalized = callId.trim().toUpperCase().replace(/\s+/g, '-')
  const queries = [normalized, ...expandCallId(normalized)]

  for (const query of queries) {
    try {
      const res = await fetch(
        `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=DONOR&text=${encodeURIComponent(query)}&pageSize=3&language=en`,
        { signal: AbortSignal.timeout(8000) }
      )
      const data = await res.json()
      const results = data?.results || []
      if (!results.length) continue
      const hit         = results[0]
      const title       = hit?.metadata?.title?.[0] || ''
      const description = hit?.metadata?.description?.[0] || hit?.metadata?.objective?.[0] || ''
      const identifier  = hit?.metadata?.identifier?.[0] || query
      if (!description) continue
      return {
        title: String(title).slice(0, 200),
        text:  `Call: ${identifier}\nTitle: ${title}\n\nObjective:\n${description}`,
      }
    } catch { /* try next */ }
  }
  return null
}

async function fetchFromTavily(callId: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  const normalized = callId.trim().toUpperCase().replace(/\s+/g, '-')
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${normalized} Horizon Europe call objective scope description`,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json()
    const parts: string[] = []
    if (data.answer) parts.push(data.answer)
    if (data.results?.length) {
      parts.push(data.results.map((r: any) => `${r.title}: ${(r.content || '').slice(0, 400)}`).join('\n\n'))
    }
    return parts.length ? `Call: ${normalized}\n\nScope (from web):\n${parts.join('\n\n')}` : null
  } catch {
    return null
  }
}

// ─── SCOPE EXTRACTION ─────────────────────────────────────────────────────────

function extractScopes(text: string): string[] {
  // Look for numbered or bulleted scope options
  const bullets = text.match(/^[\-•–]\s+(.{20,250})$/gm) || []
  if (bullets.length >= 2) return bullets.slice(0, 4).map(b => b.replace(/^[\-•–]\s+/, '').trim())

  // Look for "scope" / "topic" labels
  const scopeMatches = text.match(/(?:specific\s+)?(?:scope|topic|objective)[s]?\s*[:\-]\s*([^\n]{20,200})/gi) || []
  if (scopeMatches.length >= 1) {
    return scopeMatches.slice(0, 3).map(m =>
      m.replace(/specific\s+|scope[s]?|topic[s]?|objective[s]?\s*[:\-]\s*/gi, '').trim()
    ).filter(s => s.length > 15)
  }

  return []
}

// ─── METADATA EXTRACTION ──────────────────────────────────────────────────────

function extractBudget(text: string): string | undefined {
  const m = text.match(/(?:budget|total\s+cost|grant\s+per\s+project)[^\n€€£$\d]{0,30}[€£$]?\s*(\d[\d\s.,]*(?:M|million|B|billion)?)/i)
  return m ? m[0].trim().slice(0, 80) : undefined
}

function extractTrlRange(text: string): string | undefined {
  const m = text.match(/TRL\s*(\d)\s*(?:[-–to]+\s*(?:TRL\s*)?)?(\d)/i)
  return m ? `TRL ${m[1]}–${m[2]}` : undefined
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { callText } = await req.json()

    if (!callText?.trim()) {
      return NextResponse.json({ error: 'callText is required' }, { status: 400 })
    }

    const isId = /^HORIZON[-\s][A-Z0-9][-A-Z0-9\s]*$/i.test(callText.trim())

    let resolvedText = callText
    let callId       = 'CUSTOM'
    let callTitle    = ''

    if (isId) {
      callId = callText.trim().toUpperCase().replace(/\s+/g, '-')

      const [euResult] = await Promise.all([fetchFromEUFT(callId)])
      if (euResult) {
        resolvedText = euResult.text
        callTitle    = euResult.title
        console.log(`Resolve: EU F&T matched "${callTitle}"`)
      } else {
        const tavilyResult = await fetchFromTavily(callId)
        if (tavilyResult) {
          resolvedText = tavilyResult
          console.log(`Resolve: Tavily fallback (${resolvedText.length} chars)`)
        } else {
          console.log('Resolve: could not fetch call — using raw ID')
        }
      }
    } else {
      // Free text — use first meaningful line as title
      callTitle = callText.split('\n').find((l: string) => l.trim().length > 10)?.trim().slice(0, 120) || ''
    }

    if (!callTitle) {
      callTitle = resolvedText.split('\n').find((l: string) => l.trim().length > 10)?.trim().slice(0, 120) || callId
    }

    const template     = detectTemplate(resolvedText)
    const isTwoStage   = /two.stage|blind evaluation|first.stage/i.test(resolvedText)
    const scopes       = extractScopes(resolvedText)
    const budget       = extractBudget(resolvedText)
    const trlRange     = extractTrlRange(resolvedText)

    const result: ResolvedCall = {
      callId,
      callTitle,
      description: resolvedText,
      actionType:  template.actionType,
      budget,
      trlRange,
      scopes,
      isTwoStage,
    }

    return NextResponse.json(result)

  } catch (e: any) {
    console.error('Resolve route error:', e)
    return NextResponse.json({ error: e.message || 'Resolve failed' }, { status: 500 })
  }
}
