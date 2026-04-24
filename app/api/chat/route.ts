/**
 * IRIS KB — Chat Route
 * Place at: app/api/chat/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { embed, rerankChunks, querySummaries, fetchSummariesByDimension, searchChunks, detectProjectTags, detectGraphIntent, queryGraph, queryStructuredFacts, fetchSynthesisContext } from '@/lib/iris-kb'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── QUERY REWRITING ─────────────────────────────────────────────────────────

async function rewriteQuery(query: string, history: any[]): Promise<string> {
  if (history.length === 0) return query
  const isFollowUp =
    query.split(' ').length < 8 ||
    /\b(it|this|that|they|them|those|these|what about|and also)\b/i.test(query)
  if (!isFollowUp) return query

  const lastExchange = history.slice(-4).map((m: any) => `${m.role}: ${m.content}`).join('\n')
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'Rewrite follow-up questions as standalone search queries. Return ONLY the rewritten query, under 15 words.' },
      { role: 'user', content: `Conversation:\n${lastExchange}\n\nFollow-up: "${query}"\n\nRewrite:` }
    ],
    max_tokens: 60,
    temperature: 0
  })
  return res.choices[0].message.content?.trim() || query
}

// ─── HyDE ────────────────────────────────────────────────────────────────────

async function generateHypotheticalAnswer(query: string): Promise<string> {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are a technical writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company in Barcelona.
Write a short, dense, technical passage (3-5 sentences) that would appear in a project deliverable or report and would DIRECTLY ANSWER the question below.
Use plausible specifics: technology names, metric values, project contexts.
Write as if this IS the answer found in a document — not "IRIS may have..." but "IRIS developed... achieving...".
Do NOT explain or hedge. Output only the passage, no preamble.`
      },
      { role: 'user', content: query }
    ],
    max_tokens: 150,
    temperature: 0.3
  })
  const hypothetical = res.choices[0].message.content?.trim() || query
  console.log(`HyDE: "${hypothetical.slice(0, 100)}..."`)
  return hypothetical
}

// ─── BROAD QUERY DETECTION ───────────────────────────────────────────────────

function isBroadQuery(query: string): boolean {
  const patterns = [
    /\ball\b/i, /\bevery\b/i, /\blist\b/i,
    /\bwhat (projects|technologies|sectors|applications|results|roles|partners)\b/i,
    /\bwhich (projects|technologies|sectors)\b/i,
    /\bhas iris (worked|developed|built|been|done|led|coordinated)\b/i,
    /\biris.{0,20}(portfolio|experience|expertise|capabilities|involvement)\b/i,
    /\bhow many (projects|technologies|partners)\b/i,
    /\b(summar|overview|table of|list of)\b/i,
    /\bwhat (do|does) iris (know|have|offer|specialise)\b/i,
    /\b(sector|industry|application|role|partner|coordinator|consortium)\b/i,
    /\bcompare\b/i, /\bacross projects\b/i, /\bin which\b/i,
  ]
  return patterns.some(p => p.test(query))
}

// ─── PROJECT NAME DETECTION ───────────────────────────────────────────────────
// For specific queries that mention a project name, fetch that project's
// summaries directly — even though isBroadQuery returns false.
// This fixes the case where "what did IRIS achieve in PROPAT?" gets no summaries.

async function fetchProjectSummaries(query: string): Promise<string> {
  try {
    const all = await fetchSummariesByDimension([
      'iris_technology', 'iris_results', 'iris_validation', 'iris_role',
      'technology', 'results', 'validation', 'applications'
    ])

    // Find projects whose name or code appears in the query
    const q = query.toLowerCase()
    const matched = all.filter(p => {
      const name = (p.project_name || '').toLowerCase().replace(/^[\w\d]+-\s*/, '')
      const code = (p.project_code || '').toLowerCase()
      return q.includes(name) || q.includes(code)
    })

    if (matched.length === 0) return ''

    return matched.map(p => {
      const entries = Object.entries(p.dimensions)
        .map(([dim, summary]) => `  [${dim}]: ${summary}`)
        .join('\n')
      return `### Project: ${p.project_name} (${p.project_code})\n${entries}`
    }).join('\n\n')
  } catch (e: any) {
    console.error('Project summary fetch error:', e.message)
    return ''
  }
}

// ─── INTENT CLASSIFICATION ───────────────────────────────────────────────────

function detectNumericalIntent(query: string): boolean {
  return /\b(accuracy|precision|recall|f1.?score|rmse|r2|r²|rpd|rsd|lod|loq|detection.?limit|sensitivity|specificity|trl|yield|saving|reduction|throughput|ppm|nm|percent|score|metric|performance|benchmark)\b/i.test(query)
    || /\b(how accurate|what accuracy|what.{0,10}result|what.{0,10}performance|what.{0,10}score|what.{0,10}metric|what.{0,10}achieve|what.{0,10}measure)\b/i.test(query)
    || /\b(best|highest|lowest|maximum|minimum|average).{0,20}(accuracy|performance|result|score|metric)\b/i.test(query)
    || /\bwhich projects?.{0,30}(highest|best|most accurate|above|over|exceed|better)\b/i.test(query)
}

function detectSynthesisIntent(query: string): boolean {
  const broad = /\b(compare|comparison|across (all|projects)|summaris|summari[sz]e all|overview of all|every project|portfolio|all projects)\b/i.test(query)
  const notSingle = !/\b(one|single|specific|only)\b/i.test(query)
  return broad && notSingle
}

// ─── MAP-REDUCE SYNTHESIS ────────────────────────────────────────────────────
// For cross-project synthesis questions: collect per-project mini-answers
// then run a synthesis pass to produce a comprehensive answer.

async function mapReduceSynthesis(query: string, history: any[]): Promise<string | null> {
  const dims = [
    'iris_results', 'results', 'iris_technology', 'technology',
    'iris_validation', 'validation', 'applications', 'iris_role'
  ]
  const projects = await fetchSynthesisContext(query, dims)
  if (projects.length === 0) return null

  // Map phase: build a single large context with all project summaries
  const mapContext = projects.map(p =>
    `### ${p.projectName} (${p.projectCode})\n${p.summaryBlocks}`
  ).join('\n\n')

  // Reduce phase: single synthesis LLM call with all project data
  const groqInst = new Groq({ apiKey: process.env.GROQ_API_KEY! })
  const completion = await groqInst.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are a technical expert synthesising information across IRIS Technology Solutions' complete project portfolio.
You have pre-computed summaries for ${projects.length} projects covering technology, results, validation, and applications.

Your task is to provide a comprehensive, well-structured synthesis that:
- Identifies patterns, themes, and commonalities across projects
- Highlights standout results and achievements with specific numbers
- Groups projects by sector, technology, or theme as appropriate
- Uses inline citations in the format (ProjectCode) for every claim
- Formats the response with clear headers and bullet points
- Never omits relevant projects — cover all ${projects.length} projects provided

Be exhaustive — the user wants a complete portfolio overview, not a sample.`
      },
      ...history.slice(-4).map((m: any) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: `Question: ${query}\n\nProject portfolio data:\n\n${mapContext}`
      }
    ],
    temperature: 0,
    max_tokens: 3000
  })
  return completion.choices[0].message.content || null
}

// ─── CONFIDENCE SIGNALS ──────────────────────────────────────────────────────

interface ConfidenceSignals {
  level: 'high' | 'medium' | 'low'
  signals: string[]
  topRerank: number
  topSimilarity: number
  sourceCount: number
  hasStructuredFacts: boolean
  hasGraphFacts: boolean
  hasSummaries: boolean
}

function computeConfidence(opts: {
  chunks: any[]
  structuredFacts: string
  graphFacts: string
  summaries: string
  routedVia: string
}): ConfidenceSignals {
  const { chunks, structuredFacts, graphFacts, summaries, routedVia } = opts
  const topRerank = chunks.reduce((max, c) => Math.max(max, c.rerank_score || 0), 0)
  const topSimilarity = chunks.reduce((max, c) => Math.max(max, c.similarity || 0), 0)
  const hasStructuredFacts = structuredFacts.length > 0
  const hasGraphFacts = graphFacts.length > 0
  const hasSummaries = summaries.length > 0

  const signals: string[] = []

  if (hasStructuredFacts) signals.push('Exact numerical results from project database')
  if (hasGraphFacts) signals.push('Structured knowledge graph data')
  if (hasSummaries) signals.push('Pre-computed project summaries')
  if (chunks.length > 0) signals.push(`${chunks.length} source excerpts retrieved`)
  if (topRerank > 0.7) signals.push('High relevance source match')
  else if (topRerank > 0.4) signals.push('Moderate relevance source match')
  else if (topRerank > 0) signals.push('Low relevance source match')
  if (routedVia === 'synthesis') signals.push('Full portfolio map-reduce synthesis')

  let level: 'high' | 'medium' | 'low'
  if (hasStructuredFacts || hasGraphFacts || (topRerank > 0.6 && chunks.length >= 3)) {
    level = 'high'
  } else if (hasSummaries || (chunks.length >= 3 && topSimilarity > 0.3)) {
    level = 'medium'
  } else {
    level = 'low'
    if (chunks.length === 0) signals.push('No matching documents found')
  }

  return { level, signals, topRerank, topSimilarity, sourceCount: chunks.length, hasStructuredFacts, hasGraphFacts, hasSummaries }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query } = body
    const history = Array.isArray(body.history) ? body.history : []

    const searchQuery = await rewriteQuery(query, history)
    console.log('Search query:', searchQuery)

    // If a specific project is named, always treat as specific — even if broad keywords present
    const projectTags = detectProjectTags(searchQuery)
    const broad = isBroadQuery(searchQuery) && projectTags.length === 0
    const isNumerical = detectNumericalIntent(searchQuery) || detectNumericalIntent(query)
    const isSynthesis = detectSynthesisIntent(searchQuery) || detectSynthesisIntent(query)
    console.log(`Query type: ${broad ? 'BROAD' : 'SPECIFIC'}${projectTags.length ? ' [project: ' + projectTags.join(',') + ']' : ''}${isNumerical ? ' [numerical]' : ''}${isSynthesis ? ' [synthesis]' : ''}`)

    // SYNTHESIS PATH: cross-project map-reduce (skips vector retrieval for speed)
    if (isSynthesis && broad && !isNumerical) {
      console.log('Routing to map-reduce synthesis path')
      const synthesisAnswer = await mapReduceSynthesis(searchQuery, history)
      if (synthesisAnswer) {
        return NextResponse.json({
          answer: synthesisAnswer,
          sources: [],
          searchQuery: searchQuery !== query ? searchQuery : null,
          routedVia: 'synthesis',
          confidence: computeConfidence({ chunks: [], structuredFacts: '', graphFacts: '', summaries: 'synthesis', routedVia: 'synthesis' })
        })
      }
    }

    // HyDE: embed hypothetical answer for specific queries
    const embedText = broad
      ? searchQuery
      : await generateHypotheticalAnswer(searchQuery)

    // Run graph intent on original query too — rewriting can strip "how many" etc.
    const graphIntent = detectGraphIntent(query) !== null && detectGraphIntent(query).type !== 'none'
      ? detectGraphIntent(query)
      : detectGraphIntent(searchQuery)
    console.log('Graph intent:', graphIntent.type)

    const [embedding, summaryContext, projectSummaryContext, graphContext, structuredFactsContext] = await Promise.all([
      embed(embedText),
      broad ? querySummaries(searchQuery) : Promise.resolve(''),
      !broad ? fetchProjectSummaries(searchQuery) : Promise.resolve(''),
      graphIntent.type !== 'none' ? queryGraph(graphIntent) : Promise.resolve(''),
      isNumerical ? queryStructuredFacts(searchQuery, projectTags.length > 0 ? projectTags : undefined) : Promise.resolve('')
    ])

    if (projectTags.length) console.log('Project tags:', projectTags)
    if (structuredFactsContext) console.log(`Structured facts: ${structuredFactsContext.split('\n').length} lines`)

    const rawChunks = await searchChunks(embedding, searchQuery, 20, projectTags)

    // When project tags are detected, prefer chunks whose source_file/folder contain
    // the tag — prevents TERMINATED/unrelated files from polluting sources on fallback.
    let chunksToRerank = rawChunks
    if (projectTags.length > 0) {
      const tagged = rawChunks.filter((c: any) =>
        projectTags.some(tag =>
          (c.source_file || '').toUpperCase().includes(tag) ||
          (c.folder || '').toUpperCase().includes(tag)
        )
      )
      if (tagged.length >= 3) chunksToRerank = tagged
    }

    const filtered = await rerankChunks(searchQuery, chunksToRerank)
    console.log(`Chunks: ${rawChunks.length} retrieved, ${filtered.length} after rerank`)

    const chunkContext = filtered.map((c: any, i: number) =>
      `[Source ${i + 1} | ${c.source_file} | ${c.folder} | p${c.page_number}]\n${c.parent_text || c.chunk_text}`
    ).join('\n\n---\n\n')

    // Build context: structured facts first (ground truth numbers), then graph, then summaries, then chunks
    const parts: string[] = []
    if (structuredFactsContext) parts.push(`## Extracted Numerical Results (ground truth)\n\n${structuredFactsContext}`)
    if (graphContext) parts.push(`## Structured Graph Facts\n\n${graphContext}`)
    const combinedSummary = summaryContext || projectSummaryContext
    if (combinedSummary) parts.push(`## Pre-computed Project & Domain Summaries\n\n${combinedSummary}`)
    if (chunkContext) parts.push(`## Specific Source Excerpts\n\n${chunkContext}`)
    const context = parts.join('\n\n---\n\n') || 'No relevant documents found in the knowledge base.'

    const messages: any[] = [
      {
        role: 'system',
        content: `You are an expert internal assistant for IRIS Technology Solutions — a photonics and NIR spectroscopy company in Barcelona with ~60 staff and 15+ active Horizon Europe projects.

You have four types of context, in priority order:
1. EXTRACTED NUMERICAL RESULTS — structured data extracted from project reports: exact metrics, accuracy values, detection limits. Treat as ground truth for quantitative questions.
2. STRUCTURED GRAPH FACTS — exact counts, lists, and relationships from the knowledge graph. Treat as ground truth for structural questions.
3. PRE-COMPUTED SUMMARIES — synthesised from ALL documents for each project/domain. Use for broad questions.
4. SPECIFIC EXCERPTS — raw document chunks with exact details, numbers, quotes.

Rules:
- Extracted numerical results take priority for accuracy, performance, and metric questions.
- Graph facts take priority for counting, listing, and filtering questions.
- Synthesise across ALL summaries — do not truncate.
- Cite inline: (Results) for numerical results, (Graph) for graph facts, (ProjectName) for summaries, (Source N, p.X) for excerpts.
- Be technical and precise — audience are engineers and scientists.
- Always report specific numbers, percentages, and metrics verbatim — never paraphrase them away.
- When describing IRIS's technology capabilities, always name the core modalities (NIR spectroscopy, photonics, hyperspectral imaging) if they appear in context.
- If asked for a table, format as markdown.
- Never invent facts not in the context.`
      },
      ...history.slice(-8).map((m: any) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: `Context:\n\n${context}\n\n---\n\nQuestion: ${query}${searchQuery !== query ? `\n(Interpreted as: "${searchQuery}")` : ''}`
      }
    ]

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0,
      max_tokens: 2000
    })

    // Only surface sources that belong to the queried project(s).
    // When a specific project is detected but the fallback unfiltered search
    // returned unrelated (e.g. TERMINATED) files, exclude them from sources
    // so the client/tests don't see misleading citations.
    const sourcesRaw = filtered.map((c: any) => ({
      file: c.source_file,
      folder: c.folder,
      page: c.page_number,
      similarity: c.similarity
    }))
    const sources = projectTags.length > 0
      ? sourcesRaw.filter(s =>
          projectTags.some(tag =>
            (s.file || '').toUpperCase().includes(tag) ||
            (s.folder || '').toUpperCase().includes(tag)
          )
        )
      : sourcesRaw

    const routedVia = isNumerical ? 'numerical' : broad ? 'broad' : 'specific'
    const confidence = computeConfidence({
      chunks: filtered,
      structuredFacts: structuredFactsContext,
      graphFacts: graphContext,
      summaries: combinedSummary || '',
      routedVia
    })

    return NextResponse.json({
      answer: completion.choices[0].message.content,
      sources,
      searchQuery: searchQuery !== query ? searchQuery : null,
      routedVia,
      confidence,
      graphUsed: graphContext.length > 0
    })

  } catch (e: any) {
    console.error('CHAT API ERROR:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
