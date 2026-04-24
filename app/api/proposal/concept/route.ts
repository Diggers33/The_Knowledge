/**
 * IRIS KB — Proposal Concept Generator
 *
 * POST { callText, callId, scopeSelected, actionType }
 *   → { concepts: Concept[] }
 *
 * Uses gpt-4o (not fine-tuned) — concept generation requires strategic thinking.
 * Grounds concepts in IRIS KB (technology + results + validation dimensions).
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { fetchSummariesByDimension, queryProposalContext } from '@/lib/iris-kb'
import type { Concept } from '@/lib/proposal-types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { callText, callId, scopeSelected, actionType } = body

    if (!callText?.trim()) {
      return NextResponse.json({ error: 'callText is required' }, { status: 400 })
    }

    // ── Fetch IRIS KB context ─────────────────────────────────────────────────
    const callSnippet = callText.slice(0, 300)
    const [summaries, graphContext] = await Promise.all([
      fetchSummariesByDimension(['iris_technology', 'iris_results', 'iris_validation', 'applications']),
      queryProposalContext(callSnippet),
    ])

    const top12 = summaries.slice(0, 12)
    const kbContext = top12.map(p => {
      const dims = Object.entries(p.dimensions)
        .map(([d, s]) => `  [${d}]: ${s}`)
        .join('\n')
      return `${p.project_name} (${p.project_code}):\n${dims}`
    }).join('\n\n')

    console.log(`Concept generator: ${top12.length} projects loaded from KB`)

    // ── Build prompt ──────────────────────────────────────────────────────────
    const systemPrompt = `You are a strategic EU Horizon Europe proposal expert for IRIS Technology Solutions — a photonics and NIR spectroscopy SME in Barcelona (~60 staff, 15+ active HE projects).

IRIS's core technologies: NIR spectroscopy, hyperspectral imaging (HSI), Raman spectroscopy, LIBS, process analytical technology (PAT), AI/ML for spectral data, IoT sensor networks, digital platforms (Scadalytics, VISUM, PATBox).

Your task: Generate exactly 3 distinct, compelling project concepts for the given call and scope. Each concept must:
- Be genuinely different from the others (different technical angle, application sector, or innovation focus)
- Ground IRIS's role specifically in its real technologies from the KB context
- Have a realistic TRL journey appropriate for a ${actionType || 'RIA'}
- Have a catchy project title and pronounceable acronym
- Identify 2-4 demonstration pilots/sectors

Return ONLY valid JSON — no prose, no markdown, no explanation.

JSON schema:
{
  "concepts": [
    {
      "title": "Full project title",
      "acronym": "ACRONYM",
      "coreInnovation": "2-3 sentence description of the core technical innovation",
      "whyBeyondSotA": "Specific gap being addressed and why current approaches fail",
      "irisRole": "IRIS's specific technical contribution (1-2 sentences)",
      "irisTechnologies": ["technology1", "technology2"],
      "trlStart": 4,
      "trlEnd": 6,
      "pilots": ["sector1", "sector2"],
      "competitiveDifferentiator": "What makes this genuinely different from competitor approaches"
    }
  ]
}`

    const userMessage = `CALL TEXT:
${callText.slice(0, 3000)}

SELECTED SCOPE:
${scopeSelected || '(not specified — use the most prominent scope in the call text)'}

ACTION TYPE: ${actionType || 'RIA'}

IRIS KB — GRAPH CONTEXT (canonical technologies, past partners, stats):
${graphContext}

IRIS KB — RELEVANT PAST PROJECTS AND CAPABILITIES:
${kbContext}

Generate 3 distinct project concepts.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0].message.content || '{}'
    let parsed: { concepts: Concept[] }

    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('Concept generator: JSON parse failed:', raw.slice(0, 200))
      return NextResponse.json({ error: 'Concept generation returned invalid JSON' }, { status: 500 })
    }

    const concepts: Concept[] = (parsed.concepts || []).slice(0, 3)
    console.log(`Concept generator: returned ${concepts.length} concepts`)

    return NextResponse.json({ concepts })

  } catch (e: any) {
    console.error('Concept route error:', e)
    return NextResponse.json({ error: e.message || 'Concept generation failed' }, { status: 500 })
  }
}
