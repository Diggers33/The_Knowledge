/**
 * IRIS KB — Chat Route
 * Place at: app/api/chat/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { embed, embedBatch, rerankChunks, querySummaries, fetchSummariesByDimension, searchChunks, detectProjectTags, detectGraphIntent, queryGraph, queryStructuredFacts, fetchSynthesisContext, buildTechTableData } from '@/lib/iris-kb'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── QUERY REWRITING ─────────────────────────────────────────────────────────

function cleanSourceFile(name: string): string {
  if (!name) return name
  return name
    .replace(/^TERMINATED__/i, '')
    .replace(/^TERM[-_]/i, '')
    .replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '')
    .replace(/^\d{2,4}[-\s]+/, '')
    .trim()
}

function diversifyChunks(chunks: any[], capPerFilePage = 2, target = 8): any[] {
  const seen: Record<string, number> = {}
  const primary: any[] = []
  const overflow: any[] = []
  for (const c of chunks) {
    const key = `${c.source_file}::p${c.page_number}`
    seen[key] = seen[key] || 0
    if (seen[key] < capPerFilePage) { primary.push(c); seen[key]++ }
    else overflow.push(c)
    if (primary.length >= target) break
  }
  while (primary.length < target && overflow.length > 0) primary.push(overflow.shift())
  return primary
}

async function rewriteQuery(query: string, history: any[]): Promise<string> {
  if (history.length === 0) return query
  const isFollowUp =
    query.split(' ').length < 8 ||
    /\b(it|this|that|they|them|those|these|what about|and also)\b/i.test(query) ||
    /\b(the )?(1st|2nd|3rd|[4-9]th|first|second|third|fourth|fifth|sixth|last)( one| item| point| result| application| project| technology| example)?\b/i.test(query) ||
    /\b(more detail|more about|tell me more|expand on|elaborate on|explain that|which one|what about that)\b/i.test(query) ||
    /\b(number \d+|item \d+|point \d+|option \d+)\b/i.test(query)
  if (!isFollowUp) return query

  // Include enough of the previous assistant answer for ordinal resolution
  const lastExchange = history.slice(-4).map((m: any) => {
    const content = typeof m.content === 'string'
      ? m.content.slice(0, 1200)
      : m.content
    return `${m.role}: ${content}`
  }).join('\n')

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Rewrite follow-up questions as fully standalone search queries.
CRITICAL: If the follow-up refers to an ordinal item ("the 2nd one", "the first", "number 3"), find that exact item in the previous assistant response and name it explicitly in the rewrite.
Return ONLY the rewritten query, under 20 words. No explanation.`
      },
      { role: 'user', content: `Conversation:\n${lastExchange}\n\nFollow-up: "${query}"\n\nRewrite:` }
    ],
    max_tokens: 80,
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
    const qWords = q.split(/\s+/).filter(w => w.length >= 4)
    const matched = all.filter(p => {
      const name = (p.project_name || '').toLowerCase().replace(/^[\w\d]+-\s*/, '').replace(/^term[-_]/i, '')
      const code = (p.project_code || '').toLowerCase().replace(/^term-/i, '')
      return q.includes(name) || q.includes(code) ||
        qWords.some(w => name.includes(w) || code.includes(w))
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

// ─── TABLE GENERATION PIPELINE ───────────────────────────────────────────────
// Handles queries asking for a cross-project table (technologies × parameters × results).
// Uses the KG + project_summaries via get_project_technology_summary() RPC,
// covering all 127 projects rather than the ~6 RAG can surface.

function detectTableGenerationIntent(query: string): boolean {
  const q = query.toLowerCase()
  const hasTable  = /\b(table|spreadsheet|list.{0,10}(of|with)|create.{0,10}(a\s+)?table|show.{0,10}table|generate.{0,10}table)\b/i.test(q)
  const hasTech   = /\b(technolog|instrument|sensor|platform|software|spectroscop|imaging|nir|hsi)\b/i.test(q)
  const hasMulti  = /\b(project|parameter|result|obtain|monitor|develop|applied|across)\b/i.test(q)
  // Standalone "table of technologies" patterns even without explicit "table" keyword
  const tableOf   = /\b(technolog.{0,20}(develop|creat|built|applied).{0,30}(project|parameter|result|iris))/i.test(q)
                 || /\b(project.{0,20}technolog.{0,20}(parameter|result|applied|used|monitor))/i.test(q)
  return (hasTable && hasTech) || (hasTable && hasTech && hasMulti) || tableOf
}

async function tableGenerationPipeline(query: string, history: any[]): Promise<string | null> {
  const rows = await buildTechTableData()
  if (!rows.length) return null
  console.log(`Table pipeline: ${rows.length} projects loaded`)

  // Strip TERM- prefix and skip DOMAIN_* pseudo-entries before sending to LLM
  const filteredRows = rows.filter(r => !/^DOMAIN_/i.test(r.project_code))
  const projectCount = filteredRows.length

  // 220-char summaries — enough context for extraction, ~16K tokens total
  const projectLines = filteredRows.map(r => {
    const cleanCode = r.project_code.replace(/^TERM-/i, '')
    const tech    = r.tech_summary    ? r.tech_summary.slice(0, 220)    : ''
    const results = r.results_summary ? r.results_summary.slice(0, 220) : ''
    return `${cleanCode}|${r.tech_categories}|${r.technologies}|${tech}|${results}`
  }).join('\n')

  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 8000,
    messages: [
      {
        role: 'system',
        content: `You are a technical analyst for IRIS Technology Solutions. Create a comprehensive markdown table from the project data below.

**Table columns:** Technology Developed | Project | Parameter Monitored | Results Obtained

**Input format per line:** PROJECT_CODE | TECH_CATEGORIES | TECHNOLOGIES | TECH_CONTEXT | RESULTS_CONTEXT

**Rules — read carefully:**
1. EXACTLY ONE ROW PER PROJECT. Never create multiple rows for the same project code.
2. Technology Developed: list the 2–3 most important specific technology names from the TECHNOLOGIES field, comma-separated (title case). Use specific names like "NIR Spectroscopy", "Hyperspectral Imaging (HSI)", "VISUM Palm Analyser" — NOT broad category words like "Spectroscopy", "Sensor", "AI". If TECHNOLOGIES is empty, derive from TECH_CATEGORIES.
3. Parameter Monitored: extract from TECH_CONTEXT what is physically/chemically measured (e.g. "moisture content, protein level", "foreign body presence", "VOC concentration"). If TECH_CONTEXT is empty, infer from TECH_CATEGORIES:
   - spectroscopy → "Chemical composition, moisture, concentration"
   - hyperspectral_imaging → "Visual defects, chemical composition, contamination"
   - chemometrics → "Multivariate chemical/physical calibration"
   - ml_ai → "Process quality indicators, predictive variables"
   - sensor → "Physical/chemical process variables"
   - process_control → "Process efficiency, yield, quality KPIs"
4. Results Obtained: extract the single most important quantitative or qualitative outcome from RESULTS_CONTEXT (max 15 words). If empty, write one specific sentence based on the technology type and project domain — never use a generic fallback phrase.
5. Only use project codes that appear in the input — do NOT invent codes.
6. Cover ALL ${projectCount} projects — output exactly ${projectCount} rows.
7. Sort alphabetically by Project column.`
      },
      {
        role: 'user',
        content: `Generate exactly ${projectCount} rows, one per project.\n\nData (CODE|CATEGORIES|TECHNOLOGIES|TECH_CONTEXT|RESULTS_CONTEXT):\n\n${projectLines}`
      }
    ]
  })
  return completion.choices[0].message.content || null
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

    // Capability queries like "Does IRIS have experience with X?" need summaries even on specific path
    // because project tags (e.g. "CAR-T") can suppress the broad flag despite no real project being named.
    const isCapabilityQuery = (
      projectTags.length > 0 && projectTags.every(t => t.length <= 5) &&
      /\b(experience|expertise|capabilities?|background|has iris (worked|used|applied|developed)|does iris (have|use|work)|iris.{0,15}(experience|expertise|background|track.?record))\b/i.test(searchQuery)
    ) || /\b(does iris (have|offer|use|know|work|support)|has iris (ever|worked|used|tried|developed)|iris.{0,20}(experience|expertise|background|capabilit|track.?record|familiarity|know.?how|speciali[sz]e?)|can iris)\b/i.test(searchQuery)
    const isNumerical = detectNumericalIntent(searchQuery) || detectNumericalIntent(query)
    const isSynthesis = detectSynthesisIntent(searchQuery) || detectSynthesisIntent(query)
    console.log(`Query type: ${broad ? 'BROAD' : 'SPECIFIC'}${projectTags.length ? ' [project: ' + projectTags.join(',') + ']' : ''}${isNumerical ? ' [numerical]' : ''}${isSynthesis ? ' [synthesis]' : ''}`)

    // TABLE GENERATION PATH: comprehensive cross-project table from KG + summaries
    if (detectTableGenerationIntent(query) || detectTableGenerationIntent(searchQuery)) {
      console.log('Routing to table generation pipeline')
      const tableAnswer = await tableGenerationPipeline(searchQuery, history)
      if (tableAnswer) {
        return NextResponse.json({
          answer: tableAnswer,
          sources: [],
          searchQuery: searchQuery !== query ? searchQuery : null,
          routedVia: 'table',
          confidence: computeConfidence({ chunks: [], structuredFacts: '', graphFacts: 'table', summaries: 'table', routedVia: 'table' })
        })
      }
    }

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

    // Graph intent: check both original and rewritten query
    const graphIntent = detectGraphIntent(query) !== null && detectGraphIntent(query).type !== 'none'
      ? detectGraphIntent(query)
      : detectGraphIntent(searchQuery)
    console.log('Graph intent:', graphIntent.type)

    // Run HyDE + all DB lookups in parallel
    const [hydeText, summaryContext, projectSummaryContext, graphContext, structuredFactsContext] = await Promise.all([
      !broad ? generateHypotheticalAnswer(searchQuery) : Promise.resolve(''),
      (broad || isCapabilityQuery) ? querySummaries(searchQuery) : Promise.resolve(''),
      !broad ? fetchProjectSummaries(searchQuery) : Promise.resolve(''),
      graphIntent.type !== 'none' ? queryGraph(graphIntent) : Promise.resolve(''),
      (isNumerical || projectTags.length > 0) ? queryStructuredFacts(searchQuery, projectTags.length > 0 ? projectTags : undefined) : Promise.resolve('')
    ])

    if (projectTags.length) console.log('Project tags:', projectTags)
    if (structuredFactsContext) console.log(`Structured facts: ${structuredFactsContext.split('\n').length} lines`)

    // Dual-embed for specific queries: HyDE + raw query in one batch call for wider recall
    let primaryEmb: number[]
    let supplementalEmb: number[] | null = null
    if (broad) {
      primaryEmb = await embed(searchQuery)
    } else {
      const embs = await embedBatch([hydeText, searchQuery])
      primaryEmb = embs[0]
      supplementalEmb = embs[1]
    }

    // Retrieval: HyDE path + optional raw-query path (merged, deduplicated)
    const hydeResults = await searchChunks(primaryEmb, searchQuery, 20, projectTags)
    let rawChunks = hydeResults
    if (supplementalEmb) {
      const rawResults = await searchChunks(supplementalEmb, searchQuery, 15, projectTags)
      const seen = new Set(hydeResults.map((c: any) => c.id))
      rawChunks = [...hydeResults, ...rawResults.filter((c: any) => !seen.has(c.id))]
    }

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
      `[Source ${i + 1} | ${cleanSourceFile(c.source_file)} | ${c.folder} | p${c.page_number}]\n${c.parent_text || c.chunk_text}`
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
    const sourcesRaw = diversifyChunks(filtered, 2, 8).map((c: any) => ({
      file: cleanSourceFile(c.source_file),
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
