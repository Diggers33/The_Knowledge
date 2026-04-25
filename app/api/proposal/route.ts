/**
 * IRIS KB — Proposal Writer Route
 *
 * POST { section, callText, additionalContext }
 *   → streams text/plain (gpt-4o)
 *
 * POST { section, callText, outputType: 'docx', generatedText }
 *   → returns DOCX binary (no re-generation)
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, convertInchesToTwip,
} from 'docx'
import {
  embed, embedBatch, rerankChunks, searchChunks,
  detectProjectTags, fetchSummariesByDimension,
  queryProposalContext, searchSummariesByTopic
} from '@/lib/iris-kb'
import type { ProjectBrief } from '@/lib/proposal-types'
import type { ProposalTemplate } from '@/lib/proposal-templates'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK = '0A2E36'
const IRIS_CYAN = '00C4D4'

// ─── STYLE ENFORCEMENT (appended to every system prompt) ──────────────────────

const STYLE_ENFORCEMENT = `

VOICE:
Write in first person plural throughout — "we", "our", "we will develop", "our approach".
Never use the project acronym as the grammatical subject of a sentence.
Wrong: "SMART-MAN will develop an IoT platform..."
Right: "We will develop an IoT platform..."

SENTENCE STRUCTURE:
Vary sentence length deliberately. Use a short declarative statement to introduce an idea, then a longer sentence with supporting evidence or detail.
Never stack more than two subordinate clauses in a single sentence.
Wrong: "The platform, which integrates IoT sensors that capture real-time data across critical manufacturing parameters, including energy consumption and emissions, will be validated in pilot environments to ensure accuracy, reliability, and scalability."
Right: "The platform integrates IoT sensors for real-time process monitoring. These sensors capture energy consumption, emissions, and process variables across two industrial pilots, providing the data foundation for AI-driven optimisation."

METRICS AND EVIDENCE:
Never assert a target figure without showing the reasoning or source.
Wrong: "We target a 20% reduction in energy consumption."
Right: "Based on baseline energy audits at the pilot sites and benchmarks from comparable sensor-driven optimisation deployments (Redchuk et al., 2023), we target a 20% reduction in energy consumption, equivalent to approximately 150 MWh/year per pilot site."

CROSS-REFERENCING:
Check previously written sections. Do not restate any metric, technology name, or concept already introduced. Reference it instead.
Wrong: restating "TRL 4→6", "IoT sensor network", "20% energy reduction" in every section.
Right: "Building on the sensor architecture described in Section 1.3..." or "As detailed in the methodology above..."

TASK DESCRIPTIONS (for Implementation and Methodology sections):
Use bold task labels with partner attribution.
Format: **Task X.Y: [Task name]** (Lead: PARTNER; Partners: A, B, C)
Then describe the task in 3-5 sentences of flowing prose.

FORBIDDEN PHRASES — never use under any circumstances:
- poised to deliver
- transformative outcomes
- holistic approach
- embodies / embodies a holistic
- resonates with
- aligns with (use "supports" or "contributes to" instead)
- underscores the importance of
- it is worth noting
- it is important to highlight
- leverages its expertise
- multifaceted contributions
- in summary (never open or close a section this way)
- "Outcome 1:" / "Outcome 2:" / "Outcome 3:" as inline structural labels (use prose transitions instead: "A first outcome..." / "Beyond process efficiency...")
- needless to say
- state-of-the-art (as an adjective meaning "advanced") — use the specific technology name
- in conclusion
- multifaceted approach
- well-positioned to
- revolutionize
- revolutionise

NUMBERS AND SPECIFICITY:
Use real, specific numbers where available from the project brief and KB context.
Vague: "significant improvements in efficiency"
Specific: "a reduction in process variability from ±8% to ±2%, based on NIR calibration models validated in the HYPERA project"
`

// ─── SECTION CONFIGURATION ────────────────────────────────────────────────────

const SECTION_MODE = {
  // Legacy section IDs (old single-screen writer)
  'state_of_the_art': 'EXTERNAL',
  'iris_methodology': 'INTERNAL',
  'iris_role':        'INTERNAL',
  'innovation':       'HYBRID',
  'expected_impact':  'HYBRID',
  'excellence':       'INTERNAL',
  // Template section IDs (new wizard)
  'sota':             'EXTERNAL',
  'objectives':       'INTERNAL',
  'methodology':      'INTERNAL',
  'outcomes':         'HYBRID',
  'dissemination':    'INTERNAL',
  'communication':    'INTERNAL',
  'workplan':         'INTERNAL',
  'management':       'INTERNAL',
  'consortium':       'INTERNAL',
  'business_case':    'INTERNAL',
  'impact':           'HYBRID',
  'implementation':   'INTERNAL',
} as const

const SECTION_LABELS: Record<string, string> = {
  // Legacy
  'state_of_the_art': 'State of the Art',
  'iris_methodology': 'IRIS Methodology',
  'iris_role':        'IRIS Role in Project',
  'innovation':       'Innovation Beyond State of the Art',
  'expected_impact':  'Expected Impact',
  'excellence':       'Excellence & Credentials',
  // Template section IDs
  'sota':             'State of the Art and Innovation',
  'objectives':       'Objectives and Ambition',
  'methodology':      'Methodology',
  'outcomes':         'Expected Outcomes and Impacts',
  'dissemination':    'Dissemination, Exploitation and Communication',
  'communication':    'Communication',
  'workplan':         'Work Plan and Work Packages',
  'management':       'Management Structure',
  'consortium':       'Consortium',
  'business_case':    'Business Case and Exploitation Strategy',
  'impact':           'Impact',
  'implementation':   'Implementation',
}

// Dimensions to pull from project_summaries for each INTERNAL/HYBRID section
const SECTION_DIMS: Record<string, string[]> = {
  // Legacy
  'iris_methodology': ['iris_technology', 'technology'],
  'iris_role':        ['iris_role'],
  'excellence':       ['iris_results', 'iris_validation', 'iris_technology'],
  'innovation':       ['iris_technology', 'iris_results'],
  'expected_impact':  ['iris_results', 'applications', 'iris_role'],
  // Template section IDs
  'objectives':       ['iris_results', 'iris_validation'],
  'methodology':      ['iris_technology', 'technology'],
  'outcomes':         ['iris_results', 'applications', 'iris_role'],
  'dissemination':    ['iris_results', 'applications'],
  'workplan':         ['iris_role', 'iris_technology'],
  'management':       ['iris_role'],
  'consortium':       ['partners'],
  'business_case':    ['applications', 'iris_results'],
  'impact':           ['iris_results', 'applications'],
  'communication':    ['applications'],
  'implementation':   ['iris_role', 'iris_technology'],
}

// Seed queries per section for HyDE retrieval
const SECTION_SEEDS: Record<string, string[]> = {
  // Legacy
  'state_of_the_art': [
    'state of the art existing methods literature competing solutions',
    'recent advances research groups publications limitations current technology',
  ],
  'iris_methodology': [
    'IRIS spectroscopy methodology experimental approach calibration validation',
    'measurement protocol NIR Raman LIBS chemometrics PLS data analysis',
  ],
  'iris_role': [
    'IRIS role work package leader coordinator task responsibility',
    'IRIS contribution partner project deliverable expertise',
  ],
  'innovation': [
    'innovation beyond state of art novel breakthrough competitive advantage',
    'IRIS unique technology result improvement over existing approach',
  ],
  'expected_impact': [
    'expected impact outcomes market KPI TRL exploitation commercialisation',
    'societal economic benefit application sector cost reduction',
  ],
  'excellence': [
    'IRIS excellence credentials track record past projects expertise',
    'team results accuracy TRL achievements recognition publication patent',
  ],
  // Template section IDs
  'sota': [
    'state of the art existing methods literature competing solutions',
    'recent advances research groups publications limitations current technology',
  ],
  'objectives': [
    'project objectives measurable outcomes TRL advancement goals',
    'IRIS project results achievements milestones validation',
  ],
  'methodology': [
    'IRIS spectroscopy methodology experimental approach calibration validation',
    'measurement protocol NIR Raman LIBS chemometrics PLS AI data analysis',
  ],
  'outcomes': [
    'expected impact outcomes market KPI TRL exploitation commercialisation',
    'societal economic benefit application sector sustainability',
  ],
  'dissemination': [
    'IRIS publication open access exploitation IP standardisation',
    'dissemination results communication outreach stakeholders',
  ],
  'workplan': [
    'IRIS work package task deliverable milestone Gantt project plan',
    'IRIS role WP leader coordinator task contribution',
  ],
  'management': [
    'IRIS project management governance risk quality assurance',
    'consortium coordination decision making data management',
  ],
  'consortium': [
    'IRIS partners consortium complementarity roles expertise country',
    'partner collaboration previous IRIS project experience',
  ],
  'business_case': [
    'IRIS commercialisation market exploitation revenue business model',
    'technology transfer industrial application cost benefit investment',
  ],
  'communication': [
    'IRIS communication target audience channels public outreach',
    'stakeholder engagement media social impact awareness',
  ],
  'impact': [
    'expected impact outcomes market KPI TRL exploitation',
    'societal economic environmental benefit sustainability',
  ],
  'implementation': [
    'IRIS work package task deliverable milestone management',
    'IRIS role contribution partner coordination governance',
  ],
}

// Mode-specific instruction fragment injected into system prompt
const MODE_INSTRUCTION: Record<string, string> = {
  INTERNAL: `[FOR INTERNAL SECTIONS]: Ground every claim in IRIS's actual project data provided in the context. Reference specific projects by name. Quote real results and metrics.
CITATIONS: The Document Chunks are numbered [1], [2], etc. Add inline citations as [N] where you draw specific claims or data points from those chunks. Cite sparingly — only for specific metrics, results, or project-specific claims, not general statements.`,
  EXTERNAL: `[FOR EXTERNAL SECTIONS]: Write the State of the Art using ONLY the provided research sources. Cite specific findings, name specific research groups, methodologies, and results from the sources. Do NOT write generic landscape descriptions — every paragraph must reference specific evidence from the provided context.

CRITICAL RULES FOR STATE OF THE ART:
- Use ONLY sources, studies, institutions, and results that appear in the provided research context above
- Do NOT invent citations, percentage figures, study results, or institution names
- Do NOT mention companies or research groups not named in the provided sources
- Do NOT mention [this call] or any call identifier anywhere in the output
- If the research context is thin for a specific point — write more generally rather than inventing specifics
- Structure MUST follow this exact order:
  1. Current approaches — name specific methods, tools, key players from the sources
  2. Recent advances — cite specific results and metrics from the provided papers
  3. Remaining gaps — use - bullet points, one per gap, grounded in source limitations
  4. Why this research direction is necessary and timely
- Every paragraph must reference specific evidence from the provided context
- Never open with a sentence about [this call] or the EU programme
- Do not close with generic statements about Europe, competitiveness, or digital transformation unless directly supported by a specific source in the context
- Every gap bullet must cite a specific source — never write "as noted in the broader literature" or similar vague attribution

CITATIONS — ABSOLUTE RULE:
Use numbered inline citations [N] where N is the number of the paper in the source list provided.
You may ONLY cite papers that appear verbatim in the provided source context (EUROPE PMC, ARXIV, CROSSREF, CORE, or OPENALEX blocks above).
Do NOT invent citations. Do NOT use your training knowledge to add references not in the source blocks.
Place [N] at the end of the sentence or clause it supports, before the full stop.
Aim to cite at least one source per paragraph.`,
  HYBRID:   `[FOR HYBRID SECTIONS]: Combine the external research landscape with IRIS's specific position and demonstrated capabilities within that landscape.`,
}

// ─── HyDE PASSAGE GENERATION ─────────────────────────────────────────────────

async function generateHyDE(section: string, query: string): Promise<string[]> {
  const seeds = SECTION_SEEDS[section] || [query]
  const results = await Promise.all(seeds.map(async (seed) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a technical writer for IRIS Technology Solutions, a photonics and NIR spectroscopy SME in Barcelona.
Write a dense 3-sentence technical passage that would appear in an IRIS project proposal or deliverable, specifically relevant to the ${SECTION_LABELS[section] || section} section.
Use specifics: technology names, wavelength ranges, metric values, project names.
Output only the passage, no preamble.`
        },
        { role: 'user', content: `Call topic: ${query.slice(0, 300)}\nFocus: ${seed}` }
      ],
      temperature: 0.3,
      max_tokens: 120
    })
    return res.choices[0].message.content?.trim() || seed
  }))
  console.log(`Proposal HyDE [${section}]: ${results.length} passages`)
  return results
}

// ─── INTERNAL RETRIEVAL ───────────────────────────────────────────────────────

async function retrieveInternalContext(section: string, query: string, tagsQuery?: string): Promise<[string, string]> {
  // Step 1: try explicit project tags from the query text
  let tags = detectProjectTags(tagsQuery ?? query)

  // Step 2: if no explicit tags, use semantic project matching to find which
  // KB projects are most relevant to the call topic. This prevents unrelated
  // projects (e.g. CIRCULAR FoodPack when the call is about footwear) from
  // dominating unfiltered searches.
  if (tags.length === 0) {
    try {
      const matched = await searchSummariesByTopic(query, ['applications', 'iris_technology', 'iris_results'], 6)
      const semanticTags = matched.slice(0, 4).map((p: any) => p.project_code.toUpperCase()).filter(Boolean)
      if (semanticTags.length > 0) {
        tags = semanticTags
        console.log(`Proposal internal [${section}]: semantic project match → ${tags.join(', ')}`)
      }
    } catch (e) {
      console.warn('Semantic project matching failed (non-fatal):', e)
    }
  } else {
    console.log(`Proposal internal [${section}]: explicit tags =`, tags)
  }

  const hydePassages = await generateHyDE(section, query)
  const allTexts = [query.slice(0, 500), ...hydePassages]
  const embeddings = await embedBatch(allTexts)
  const [primaryEmb, ...hydeEmbs] = embeddings
  const tagFilter = tags.length > 0 ? tags : undefined
  const seeds = SECTION_SEEDS[section] || [query]

  const [primaryResults, ...hydeResults] = await Promise.all([
    searchChunks(primaryEmb, query.slice(0, 500), 20, tagFilter),
    ...hydeEmbs.map((emb: number[], i: number) =>
      searchChunks(emb, seeds[i] || query, 10, tagFilter)
    )
  ])

  const seen = new Set<number>()
  const merged: any[] = []
  for (const batch of [primaryResults, ...hydeResults]) {
    for (const c of batch) {
      if (!seen.has(c.id)) { seen.add(c.id); merged.push(c) }
    }
  }

  const reranked = await rerankChunks(query.slice(0, 200), merged)
  const topChunks = reranked.slice(0, 10)
  console.log(`Proposal internal: ${merged.length} unique → ${topChunks.length} reranked`)

  const chunkText = topChunks
    .map((c: any, i: number) => `[${i + 1}] ${(c.chunk_text || c.parent_text || '').slice(0, 500)}`)
    .join('\n\n')

  // Build a citable source index to append after streaming
  const kbSourceBlock = topChunks
    .map((c: any, i: number) => `[${i + 1}] ${c.source_file || 'IRIS KB'} | p${c.page_number || '?'}`)
    .join('\n')

  // Project summaries + graph context in parallel
  const dims = SECTION_DIMS[section] || []
  const [summaryProjects, graphContext] = await Promise.all([
    dims.length > 0 ? searchSummariesByTopic(query, dims, 15) : Promise.resolve([]),
    queryProposalContext(query)
  ])

  let summaryText = ''
  if (summaryProjects.length > 0) {
    // Narrow to tagged projects if any, otherwise take top 12
    const relevant = tags.length > 0
      ? summaryProjects.filter(p =>
          tags.some(t =>
            p.project_code.toUpperCase().includes(t) ||
            p.project_name.toUpperCase().includes(t)
          )
        )
      : summaryProjects
    const top = relevant.slice(0, 12)
    summaryText = top.map(p => {
      const dimLines = Object.entries(p.dimensions)
        .map(([d, s]) => `  [${d}]: ${s}`)
        .join('\n')
      return `Project: ${p.project_name} (${p.project_code})\n${dimLines}`
    }).join('\n\n')
  }

  const parts: string[] = []
  if (graphContext) parts.push(`--- Graph Context ---\n${graphContext}`)
  if (chunkText) parts.push(`--- Document Chunks ---\n${chunkText}`)
  if (summaryText) parts.push(`--- Project Summaries ---\n${summaryText}`)
  return [parts.join('\n\n'), kbSourceBlock]
}

// ─── UNPAYWALL FULL-TEXT RESOLUTION ──────────────────────────────────────────

interface ResolvedPdf {
  doi: string
  pdfUrl: string
  title: string
}

async function resolveFullText(dois: string[]): Promise<ResolvedPdf[]> {
  const email = process.env.UNPAYWALL_EMAIL
  if (!email) { console.warn('UNPAYWALL_EMAIL not set — skipping full-text resolution'); return [] }

  const results = await Promise.allSettled(
    dois.map(async (doi): Promise<ResolvedPdf | null> => {
      const res = await fetch(
        `https://api.unpaywall.org/v2/${doi}?email=${email}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return null
      const data = await res.json()
      if (!data.is_oa || !data.best_oa_location?.url_for_pdf) return null
      return { doi, pdfUrl: data.best_oa_location.url_for_pdf as string, title: (data.title as string) || doi }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<ResolvedPdf> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .slice(0, 8)
}

async function extractPdfText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule
    const data = await pdfParse(Buffer.from(buffer), { max: 4 })
    return data.text.slice(0, 2000).trim() || null
  } catch (e) {
    console.error('PDF extraction failed:', e)
    return null
  }
}

// ─── EXTERNAL RETRIEVAL ───────────────────────────────────────────────────────

function extractTopicKeywords(callText: string): string {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'shall', 'this', 'that',
    'these', 'those', 'it', 'its', 'which', 'who', 'what', 'how', 'when',
    'where', 'why', 'all', 'any', 'both', 'each', 'more', 'most', 'other',
    'also', 'into', 'through', 'during', 'such', 'between', 'must',
    'including', 'within', 'their', 'they', 'them', 'thus', 'while', 'well',
    'only', 'under', 'over', 'same', 'new', 'based', 'search', 'targeting',
    'opened', 'december', 'march', 'october', 'november', 'january', 'february',
    'april', 'budget', 'million', 'deadline', 'stage', 'two', 'three', 'four', 'five',
    // EU call metadata noise
    '2023', '2024', '2025', '2026', '2027',
    'horizon', 'europe', 'european', 'call', 'topic', 'scope', 'web',
    'cluster', 'destination', 'programme', 'framework',
    'action', 'innovation', 'research', 'proposal', 'proposals',
    'project', 'projects', 'twin', 'transition', 'aims', 'enhance',
    'activities', 'support', 'develop', 'provide', 'ensure', 'promote',
    'address', 'contribute', 'relevant', 'specific', 'particular',
    'circbio', 'circ', 'biobased', 'lca', 'sme', 'trl', 'ict', 'kpi', 'smes',
    'pilots', 'pilot', 'scale', 'uptake', 'deploy', 'deployment', 'uptake',
    'demonstrat', 'demonstrators', 'demonstrator',
  ])
  return callText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 12)
    .join(' ')
}

// Drop paper blocks whose title+abstract share no keywords with the call topic.
// Prevents off-domain papers (e.g. cybersecurity, 6G) from polluting SotA sections.
function filterPaperBlocksByKeywords(sourceText: string, topicKeywords: string, minMatches = 1): string {
  if (!sourceText || !topicKeywords) return sourceText
  const kwSet = new Set(topicKeywords.toLowerCase().split(/\s+/).filter(k => k.length > 3))
  if (kwSet.size === 0) return sourceText

  const blocks = sourceText.split(/\n\n+/)
  const filtered = blocks.filter(block => {
    const lower = block.toLowerCase()
    let hits = 0
    for (const kw of kwSet) {
      if (lower.includes(kw)) { hits++; if (hits >= minMatches) return true }
    }
    return false
  })

  if (filtered.length < blocks.length) {
    console.log(`Citation filter: dropped ${blocks.length - filtered.length}/${blocks.length} off-topic paper blocks`)
  }
  return filtered.join('\n\n')
}

async function tavilySearch(
  query: string,
  options: { search_depth?: string; max_results?: number; include_domains?: string[] }
): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      include_answer: true,
      ...options,
    }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json()
  const parts: string[] = []
  if (data.answer) parts.push(data.answer)
  if (data.results?.length) {
    parts.push(
      data.results
        .map((r: any) => `${r.title}: ${(r.content || '').slice(0, 350)}`)
        .join('\n\n')
    )
  }
  return parts.join('\n\n')
}

async function searchEuropePMC(query: string, limit = 6): Promise<string> {
  try {
    console.log(`[EuropePMC] query: "${query.trim()}"`)
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query.trim())}&resultType=core&pageSize=${limit}&format=json&sort=CITED+desc`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    console.log(`[EuropePMC] status: ${res.status}`)
    if (!res.ok) return ''
    const data = await res.json()
    const papers: any[] = data?.resultList?.result || []
    if (!papers.length) return ''
    return papers
      .filter((p: any) => p.abstractText && (p.pubYear ?? 0) >= 2019)
      .map((p: any) => {
        const doi = p.doi ? `\nDOI: https://doi.org/${p.doi}` : ''
        const authors = (p.authorString || '').split(',').slice(0, 3).join(',')
        return `Title: ${p.title} (${p.pubYear})\nAuthors: ${authors}\nCitations: ${p.citedByCount ?? 0}${doi}\nAbstract: ${(p.abstractText || '').slice(0, 400)}`
      })
      .join('\n\n')
  } catch (e) {
    console.error('EuropePMC error:', e)
    return ''
  }
}

async function searchArxiv(query: string, limit = 5): Promise<string> {
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query.trim())}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`,
      { signal: AbortSignal.timeout(15000) }
    )
    const xml = await res.text()
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    return entries.map(([, entry]) => {
      const title     = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || ''
      const summary   = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().slice(0, 400) || ''
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1]?.slice(0, 10) || ''
      const authors   = [...entry.matchAll(/<name>(.*?)<\/name>/g)].slice(0, 3).map(m => m[1]).join(', ')
      return `Title: ${title} (${published})\nAuthors: ${authors}\nAbstract: ${summary}`
    }).join('\n\n')
  } catch (e) {
    console.error('arXiv error:', e)
    return ''
  }
}

async function searchCrossref(query: string, limit = 5): Promise<string> {
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query.trim())}&rows=${limit}&filter=from-pub-date:2020&sort=relevance&select=title,abstract,author,published,DOI,is-referenced-by-count`
    console.log(`[Crossref] URL: ${url}`)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'IRIS-KB/1.0 (mailto:info@iris-eng.com)' },
      signal: AbortSignal.timeout(8000),
    })
    console.log(`[Crossref] status: ${res.status}`)
    const data = await res.json()
    console.log(`[Crossref] first item keys: ${Object.keys(data?.message?.items?.[0] || {}).join(', ')}`)
    if (!data.message?.items?.length) return ''
    return data.message.items
      .map((w: any) => {
        const title    = w.title?.[0] || ''
        if (!title) return null
        const year     = w.published?.['date-parts']?.[0]?.[0] || ''
        const authors  = w.author?.slice(0, 3).map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()).join(', ') || ''
        const abstract = w.abstract?.replace(/<[^>]+>/g, '').slice(0, 400) || ''
        return `Title: ${title} (${year})\nAuthors: ${authors}\nDOI: https://doi.org/${w.DOI}\nCitations: ${w['is-referenced-by-count'] || 0}${abstract ? '\nAbstract: ' + abstract : ''}`
      })
      .filter(Boolean)
      .join('\n\n')
  } catch (e) {
    console.error('Crossref error:', e)
    return ''
  }
}

async function searchCORE(query: string, limit = 5): Promise<string> {
  const apiKey = process.env.CORE_API_KEY
  if (!apiKey) { console.warn('CORE_API_KEY not set — skipping CORE search'); return '' }
  console.log(`[CORE] API key present (${apiKey.slice(0, 6)}…), query: "${query.trim()}"`)
  try {
    const res = await fetch(
      `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query.trim())}&limit=${limit}&api_key=${encodeURIComponent(apiKey)}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      }
    )
    const data = await res.json()
    if (!data.results?.length) return ''
    return data.results
      .filter((w: any) => w.abstract)
      .map((w: any) =>
        `Title: ${w.title} (${w.yearPublished})\nAuthors: ${w.authors?.slice(0, 3).map((a: any) => a.name).join(', ')}\nAbstract: ${w.abstract?.slice(0, 400)}`
      ).join('\n\n')
  } catch (e) {
    console.error('CORE error:', e)
    return ''
  }
}

async function searchOpenAlex(query: string, limit = 6): Promise<string> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query.trim())}&per-page=${limit}&filter=from_publication_date:2020-01-01,has_abstract:true&sort=cited_by_count:desc&mailto=info@iris-eng.com`
    console.log(`[OpenAlex] query: "${query.trim()}"`)
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) { console.warn(`[OpenAlex] status ${res.status}`); return '' }
    const data = await res.json()
    if (!data.results?.length) return ''
    return data.results
      .filter((w: any) => w.abstract_inverted_index || w.abstract)
      .slice(0, limit)
      .map((w: any) => {
        const authors = w.authorships?.slice(0, 3).map((a: any) => a.author?.display_name).filter(Boolean).join(', ') || ''
        const year    = w.publication_year || ''
        const doi     = w.doi ? `\nDOI: ${w.doi}` : ''
        const cites   = w.cited_by_count ?? 0
        // OpenAlex stores abstract as inverted index — reconstruct
        let abstract = ''
        if (w.abstract_inverted_index) {
          const positions: [string, number][] = []
          for (const [word, pos] of Object.entries(w.abstract_inverted_index as Record<string, number[]>)) {
            for (const p of pos as number[]) positions.push([word, p])
          }
          abstract = positions.sort((a, b) => a[1] - b[1]).map(p => p[0]).join(' ').slice(0, 400)
        }
        return `Title: ${w.display_name} (${year})\nAuthors: ${authors}\nCitations: ${cites}${doi}\nAbstract: ${abstract}`
      }).join('\n\n')
  } catch (e) {
    console.error('OpenAlex error:', e)
    return ''
  }
}

async function retrieveExternalContext(query: string, keywordSource: string): Promise<string> {
  const topicKeywords    = extractTopicKeywords(keywordSource)
  const academicKeywords = topicKeywords.split(' ').slice(0, 4).join(' ')
  const openAireQuery    = topicKeywords.split(' ').slice(0, 3).join(' ')
  console.log(`Topic keywords: ${topicKeywords}`)
  console.log(`Academic keywords (SS/Crossref/CORE/OpenAlex): ${academicKeywords}`)
  console.log(`OpenAIRE query: ${openAireQuery}`)

  // Europe PMC with retry on 0 results
  let ssResults = await searchEuropePMC(`${academicKeywords} process industry sensor`)
  if (!ssResults) {
    const shortQuery = topicKeywords.split(' ').slice(0, 3).join(' ')
    ssResults = await searchEuropePMC(`${shortQuery}`)
    console.log(`[EuropePMC] retry with: "${shortQuery}"`)
  }

  const [
    arxivResults,
    crossrefResults,
    coreResults,
    openAlexResults,
    euProjectResults,
    industryResults,
  ] = await Promise.all([
    searchArxiv(`${topicKeywords} artificial intelligence industrial`),
    searchCrossref(`${academicKeywords} machine learning process optimization`),
    searchCORE(`${academicKeywords} AI sustainability industry`),
    searchOpenAlex(`${academicKeywords} sensor measurement spectroscopy`),
    searchOpenAIREProjects(openAireQuery),
    tavilySearch(`${topicKeywords} challenges limitations industrial deployment 2024 2025`, {
      search_depth: 'advanced',
      max_results: 4,
    }),
  ])

  console.log(`Research sources: EuropePMC=${ssResults.length} arXiv=${arxivResults.length} Crossref=${crossrefResults.length} CORE=${coreResults.length} OpenAlex=${openAlexResults.length} OpenAIRE=${euProjectResults.length}`)

  // ─── Relevance filter: drop off-topic paper blocks ────────────────────────
  const filteredSS         = filterPaperBlocksByKeywords(ssResults, topicKeywords)
  const filteredArxiv      = filterPaperBlocksByKeywords(arxivResults, topicKeywords)
  const filteredCrossref   = filterPaperBlocksByKeywords(crossrefResults, topicKeywords)
  const filteredCore       = filterPaperBlocksByKeywords(coreResults, topicKeywords)
  const filteredOpenAlex   = filterPaperBlocksByKeywords(openAlexResults, topicKeywords)

  // ─── Full-text layer: extract DOIs from filtered SS + Crossref, resolve via Unpaywall ─
  const doiPattern = /(?:URL|DOI): https:\/\/doi\.org\/([^\s\n]+)/g
  const collectedDois: string[] = []
  for (const src of [filteredSS, filteredCrossref]) {
    if (!src) continue
    for (const m of src.matchAll(doiPattern)) collectedDois.push(m[1])
  }
  console.log(`Full-text layer: ${collectedDois.length} DOIs collected from SS+Crossref`)

  let fullTextBlock = ''
  if (collectedDois.length > 0) {
    const resolvedPdfs = await resolveFullText(collectedDois)
    console.log(`Full-text layer: ${resolvedPdfs.length} open-access PDFs resolved`)

    const extractions = await Promise.all(
      resolvedPdfs.map(r => extractPdfText(r.pdfUrl).then(text => ({ title: r.title, text })))
    )

    let totalChars = 0
    const fullTextParts: string[] = []
    for (const { title, text } of extractions) {
      if (!text) continue
      const block = `[FULL TEXT - ${title}]\n${text}\n`
      if (totalChars + block.length > 8000) break
      fullTextParts.push(block)
      totalChars += block.length
    }
    if (fullTextParts.length > 0) {
      fullTextBlock = fullTextParts.join('\n')
      console.log(`Full-text layer: ${fullTextParts.length} PDFs injected (${totalChars} chars)`)
    }
  }

  const externalContext = [
    filteredSS       ? `[EUROPE PMC — Peer-reviewed papers]\n${filteredSS}`                      : '',
    filteredArxiv    ? `[ARXIV — Latest preprints]\n${filteredArxiv}`                          : '',
    filteredCrossref ? `[CROSSREF — Published research with DOIs]\n${filteredCrossref}`        : '',
    filteredCore     ? `[CORE — Open access full text]\n${filteredCore}`                       : '',
    filteredOpenAlex ? `[OPENALEX — Works with citations]\n${filteredOpenAlex}`                : '',
    euProjectResults ? `[RELATED EU-FUNDED PROJECTS — OpenAIRE]\n${euProjectResults}`         : '',
    industryResults  ? `[INDUSTRY CHALLENGES & GAPS]\n${industryResults}`                     : '',
    fullTextBlock    ? `[FULL TEXT — Open-access PDFs via Unpaywall]\n${fullTextBlock}`        : '',
  ].filter(Boolean).join('\n\n---\n\n')

  console.log(`External context: ${externalContext.length} chars total`)
  if (!externalContext) {
    console.warn('WARNING: No external research retrieved — SotA quality will be poor')
  }

  return externalContext
}

// ─── STYLE EXAMPLES FROM DoA/PROPOSAL CHUNKS ─────────────────────────────────

async function retrieveStyleExamples(query: string): Promise<string> {
  try {
    const shortQuery = query.slice(0, 500)
    const embedding = await embed(shortQuery)
    const chunks = await searchChunks(embedding, shortQuery, 10, undefined)
    const filtered = (chunks as any[]).filter(c => {
      const src = (c.source_file || '').toLowerCase()
      return src.includes('doa') || src.includes('proposal') || src.includes('part_b')
    })
    if (!filtered.length) return ''
    return filtered.slice(0, 5)
      .map((c: any) => (c.chunk_text || c.parent_text || '').slice(0, 400))
      .join('\n\n---\n\n')
  } catch (e: any) {
    console.error('Style examples error:', e.message)
    return ''
  }
}

// ─── DOCX BUILDER ─────────────────────────────────────────────────────────────

// ─── INLINE MARKDOWN PARSER ───────────────────────────────────────────────────

function parseInlineRuns(text: string): TextRun[] {
  // Split on **bold** and [N] citation patterns
  const segments = text.split(/(\*\*(?:.+?)\*\*|\[\d+(?:[,\-]\d+)*\])/g)
  const runs: TextRun[] = []
  for (const seg of segments) {
    if (!seg) continue
    const boldMatch = seg.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) {
      runs.push(new TextRun({ text: boldMatch[1], bold: true, font: 'Arial', size: 22, color: '1F3864' }))
      continue
    }
    const citeMatch = seg.match(/^(\[\d+(?:[,\-]\d+)*\])$/)
    if (citeMatch) {
      runs.push(new TextRun({ text: citeMatch[1], superScript: true, font: 'Arial', size: 16, color: '4A9EFF', bold: true }))
      continue
    }
    runs.push(new TextRun({ text: seg, font: 'Arial', size: 22 }))
  }
  return runs
}

// ─── DOCX BUILDER (markdown-aware) ────────────────────────────────────────────

async function buildDocxFromText(
  sectionLabel: string,
  callText: string,
  text: string
): Promise<Buffer> {
  // Split on reference block
  const [mainBody, refBody] = text.split(/---\n\*\*References\*\*/)

  // Page margin: 2 cm = 1134 twips
  const margin2cm = convertInchesToTwip(0.787) // ≈ 1134 twips (2 cm)

  const cellBorder = {
    top:    { style: BorderStyle.SINGLE, size: 4, color: 'D0D8EE' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D8EE' },
    left:   { style: BorderStyle.SINGLE, size: 4, color: 'D0D8EE' },
    right:  { style: BorderStyle.SINGLE, size: 4, color: 'D0D8EE' },
  }

  // ── Parse main body lines ──────────────────────────────────────────────────
  const bodyChildren: (Paragraph | Table)[] = []
  const lines = (mainBody || '').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip horizontal rules
    if (/^---$/.test(line.trim())) { i++; continue }

    // Heading 2
    const h2 = line.match(/^## (.+)/)
    if (h2) {
      bodyChildren.push(new Paragraph({
        children: [new TextRun({ text: h2[1].trim(), bold: true, font: 'Arial', size: 28, color: '1F3864' })],
        spacing: { before: 280, after: 140 },
      }))
      i++; continue
    }

    // Heading 3
    const h3 = line.match(/^### (.+)/)
    if (h3) {
      bodyChildren.push(new Paragraph({
        children: [new TextRun({ text: h3[1].trim(), bold: true, font: 'Arial', size: 24, color: '1F3864' })],
        spacing: { before: 240, after: 120 },
      }))
      i++; continue
    }

    // Bullet
    const bullet = line.match(/^[-*] (.+)/)
    if (bullet) {
      bodyChildren.push(new Paragraph({
        children: parseInlineRuns(bullet[1].trim()),
        bullet: { level: 0 },
        indent: { left: 360, hanging: 360 },
        spacing: { after: 60 },
      }))
      i++; continue
    }

    // Table — collect consecutive table lines
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      // Skip separator rows (|---|)
      const dataRows = tableLines.filter(l => !/^\|[-:\s|]+\|?$/.test(l.trim()))
      if (dataRows.length > 0) {
        const parsedRows = dataRows.map(l =>
          l.split('|').slice(1, -1).map(c => c.trim())
        )
        const colCount = Math.max(...parsedRows.map(r => r.length))
        const colWidth = Math.floor(9360 / colCount) // approx twips for A4 body width

        const wordRows = parsedRows.map((row, ri) =>
          new TableRow({
            children: row.map(cell =>
              new TableCell({
                children: [new Paragraph({
                  children: parseInlineRuns(cell),
                  spacing: { after: 60 },
                })],
                borders: cellBorder,
                shading: ri === 0 ? { fill: 'EEF1FA' } : undefined,
                width: { size: colWidth, type: WidthType.DXA },
              })
            ),
          })
        )
        bodyChildren.push(new Table({
          rows: wordRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }))
      }
      continue
    }

    // Normal paragraph (skip blank lines)
    if (line.trim()) {
      bodyChildren.push(new Paragraph({
        children: parseInlineRuns(line.trim()),
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120, line: 253 },
      }))
    }
    i++
  }

  // ── Parse references ───────────────────────────────────────────────────────
  const refChildren: (Paragraph | Table)[] = []
  if (refBody) {
    refChildren.push(new Paragraph({
      children: [new TextRun({ text: 'References', bold: true, font: 'Arial', size: 22, color: '1F3864' })],
      spacing: { before: 480, after: 120 },
    }))
    const refLines = refBody.split('\n').filter(l => l.trim() && l.trim() !== '**References**')
    for (const rl of refLines) {
      refChildren.push(new Paragraph({
        children: [new TextRun({ text: rl.trim(), font: 'Arial', size: 20, color: '5A6A9A' })],
        indent: { left: 360, hanging: 360 },
        spacing: { after: 80 },
      }))
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: margin2cm, bottom: margin2cm, left: margin2cm, right: margin2cm },
          size: { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) }, // A4
        },
      },
      children: [
        // Cover header
        new Paragraph({
          children: [new TextRun({ text: sectionLabel, bold: true, font: 'Arial', size: 52, color: IRIS_DARK })],
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Call topic: ${callText.slice(0, 400)}`, font: 'Arial', size: 24, color: IRIS_CYAN, italics: true })],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun({
            text: `IRIS Technology Solutions · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
            font: 'Arial', size: 20, color: '64748B',
          })],
          spacing: { after: 600 },
        }),
        // Body paragraphs + tables
        ...bodyChildren,
        // References
        ...refChildren,
      ],
    }],
  })

  return Packer.toBuffer(doc)
}

// ─── CALL ID AUTO-LOOKUP ──────────────────────────────────────────────────────

function isCallIdentifier(text: string): boolean {
  return /^HORIZON[-\s][A-Z0-9][-A-Z0-9\s]*$/i.test(text.trim())
}

// Generate year-inserted expansions for truncated call IDs that omit the year.
// e.g. HORIZON-CL4-EMERGING-53 → HORIZON-CL4-2026-EMERGING-53, HORIZON-CL4-2025-EMERGING-53, …
function expandCallId(normalized: string): string[] {
  const parts = normalized.split('-')
  if (parts.some(p => /^20\d{2}$/.test(p))) return [] // already has a year
  if (parts.length < 3) return []
  // Insert year candidates after the cluster/pillar segment (index 1)
  return ['2026', '2025', '2027', '2024'].map(
    y => [parts[0], parts[1], y, ...parts.slice(2)].join('-')
  )
}

async function fetchCallDetails(callId: string): Promise<string> {
  const normalized = callId.trim().toUpperCase().replace(/\s+/g, '-')
  const queriesToTry = [normalized, ...expandCallId(normalized)]

  for (const query of queriesToTry) {
    try {
      const res = await fetch(
        `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=DONOR&text=${encodeURIComponent(query)}&pageSize=3&language=en`,
        { signal: AbortSignal.timeout(8000) }
      )
      const data = await res.json()
      const results = data?.results || []
      if (results.length === 0) continue
      const hit         = results[0]
      const title       = hit?.metadata?.title?.[0] || ''
      const description = hit?.metadata?.description?.[0] || hit?.metadata?.objective?.[0] || ''
      const identifier  = hit?.metadata?.identifier?.[0] || query
      if (!description) continue
      console.log(`Call resolved via EU F&T: "${title}" (matched query: ${query})`)
      return `Call: ${identifier}\nTitle: ${title}\n\nObjective:\n${description}`
    } catch (e: any) {
      console.error(`EU F&T API error (${query}):`, e.message)
    }
  }
  return ''
}

async function searchOpenAIREProjects(query: string, limit = 5): Promise<string> {
  try {
    console.log(`[OpenAIRE] query: "${query}"`)
    // OpenAIRE Graph API v1 (stable since 2023, replaces legacy search/projects endpoint)
    const url = `https://api.openaire.eu/graph/v1/projects?keywords=${encodeURIComponent(query.trim())}&pageSize=${limit}`
    console.log(`[OpenAIRE] URL: ${url}`)
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'IRIS-KB/1.0 (mailto:info@iris-eng.com)',
      },
      signal: AbortSignal.timeout(8000),
    })
    console.log(`[OpenAIRE] status: ${res.status}`)
    if (!res.ok) {
      console.warn(`[OpenAIRE] non-200: ${res.status}`)
      return ''
    }
    const data = await res.json()
    const projects: any[] = data?.results || []
    console.log(`[OpenAIRE] results: ${projects.length}`)
    if (!projects.length) return ''
    return projects
      .map((p: any) => {
        const title   = p.title || ''
        const summary = (p.summary || p.description || '').slice(0, 350)
        const acronym = p.acronym || ''
        const code    = p.code || p.grantId || ''
        const start   = (p.startDate || '').slice(0, 4)
        const end     = (p.endDate   || '').slice(0, 4)
        if (!title && !summary) return null
        const header = [
          `Project: ${title}`,
          acronym ? `(${acronym})` : '',
          code    ? `— Grant: ${code}` : '',
          start   ? `${start}–${end}` : '',
        ].filter(Boolean).join(' ')
        return `${header}\nSummary: ${summary}`
      })
      .filter(Boolean)
      .join('\n\n')
  } catch (e) {
    console.error('OpenAIRE error:', e)
    return ''
  }
}

async function fetchCallFromTavily(callId: string): Promise<string> {
  const normalized = callId.trim().toUpperCase().replace(/\s+/g, '-')
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: `${normalized} Horizon Europe call objective scope`,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      })
    })
    const data = await res.json()
    const parts: string[] = []
    if (data.answer) parts.push(data.answer)
    if (data.results?.length) {
      parts.push(
        data.results
          .map((r: any) => `${r.title}: ${(r.content || '').slice(0, 400)}`)
          .join('\n\n')
      )
    }
    if (!parts.length) return ''
    console.log(`Call resolved via Tavily: "${normalized}"`)
    return `Call: ${normalized}\n\nScope (from web search):\n${parts.join('\n\n')}`
  } catch (e: any) {
    console.error('Tavily call fallback error:', e.message)
    return ''
  }
}

// ─── CITATION VALIDATION ──────────────────────────────────────────────────────

interface SourcePaper {
  authors: string   // lowercase, as-retrieved
  year: string
  title?: string
  url?: string      // doi.org or arxiv.org URL
}

function parseSourcePapers(externalCtx: string): SourcePaper[] {
  const papers: SourcePaper[] = []
  // Split on lines starting with "Title:" to get per-paper blocks
  const blocks = externalCtx.split(/\n(?=Title:)/)
  for (const block of blocks) {
    const titleLine  = block.match(/Title:\s+(.+?)\s*\((\d{4})\)/)
    const authorMatch = block.match(/Authors:\s+(.+)/)
    if (!titleLine || !authorMatch) continue
    const urlMatch = block.match(/(https?:\/\/(?:doi\.org|arxiv\.org)\/\S+)/)
    // Also check DOI: line format from Crossref
    const doiLineMatch = block.match(/DOI:\s+(https?:\/\/\S+)/)
    papers.push({
      year:    titleLine[2],
      title:   titleLine[1].trim(),
      authors: authorMatch[1].toLowerCase(),
      url:     doiLineMatch?.[1] ?? urlMatch?.[1],
    })
  }
  return papers
}

function validateCitations(
  generatedText: string,
  sourcePapers: SourcePaper[]
): { valid: string[]; invalid: string[] } {
  // Match numbered citations [1], [2], [1,2], [1-3]
  const citationPattern = /\[(\d+(?:[,–\-]\d+)*)\]/g
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let match
  while ((match = citationPattern.exec(generatedText)) !== null) {
    const key = match[0]
    if (seen.has(key)) continue
    seen.add(key)
    const nums = match[1].split(/[,–\-]/).map(n => parseInt(n.trim(), 10))
    const allValid = nums.every(n => n >= 1 && n <= sourcePapers.length)
    if (allValid) valid.push(key)
    else invalid.push(key)
  }
  return { valid, invalid }
}

// ─── REFERENCE EXTRACTION ─────────────────────────────────────────────────────

async function extractAndFormatReferences(sectionText: string, sourcePapers: SourcePaper[]): Promise<string> {
  // Find all [N] citation numbers used in the text
  const citationPattern = /\[(\d+(?:[,–\-]\d+)*)\]/g
  const usedNums = new Set<number>()
  let match
  while ((match = citationPattern.exec(sectionText)) !== null) {
    match[1].split(/[,–\-]/).forEach(n => {
      const num = parseInt(n.trim(), 10)
      if (num >= 1 && num <= sourcePapers.length) usedNums.add(num)
    })
  }
  if (usedNums.size === 0) {
    // No inline citations — still emit the full source list as a "Sources consulted" block
    if (sourcePapers.length === 0) return ''
    return sourcePapers.map((p, i) =>
      `${i + 1}. ${p.authors} (${p.year}). ${p.title}.${p.url ? ' ' + p.url : ''}`
    ).join('\n')
  }

  // Build numbered reference list for cited papers only
  const refs = Array.from(usedNums).sort((a, b) => a - b).map(n => {
    const p = sourcePapers[n - 1]
    return `${n}. ${p.authors} (${p.year}). ${p.title}.${p.url ? ' ' + p.url : ''}`
  })
  console.log(`References: ${refs.length} cited sources formatted`)
  return refs.join('\n')
}

// ─── LATEX → MARKDOWN CONVERTER ──────────────────────────────────────────────

function convertLatexToMarkdown(text: string): string {
  return text
    .replace(/\\begin\{(?:array|tabular)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{(?:array|tabular)\}/g,
      (_match, inner: string) => {
        const rows = inner
          .split(/\\\\/)
          .map((r: string) => r.trim())
          .filter((r: string) => r && !/^\\hline\s*$/.test(r))
        const mdRows = rows.map((row: string) => {
          const cleaned = row
            .replace(/\\hline/g, '')
            .replace(/\\text\{([^}]+)\}/g, '$1')
            .replace(/\\textbf\{([^}]+)\}/g, '**$1**')
            .trim()
          const cells = cleaned.split('&').map((c: string) => c.trim())
          return `| ${cells.join(' | ')} |`
        })
        if (mdRows.length === 0) return ''
        const cols = (mdRows[0].match(/\|/g) || []).length - 1
        const sep = `|${' --- |'.repeat(cols)}`
        return [mdRows[0], sep, ...mdRows.slice(1)].join('\n')
      }
    )
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\textbf\{([^}]+)\}/g, '**$1**')
    .replace(/\\begin\{[^}]+\}/g, '')
    .replace(/\\end\{[^}]+\}/g, '')
    .replace(/\\hline/g, '')
}

// ─── WORKPLAN MULTI-PASS GENERATOR ───────────────────────────────────────────
// Generates Section 3.1 in two passes to prevent degenerate token loops:
//   Pass 1 — structured JSON: WP list, deliverables, milestones, risks tables
//   Pass 2 — prose: one GPT call per WP (~450 words each), run in parallel
// Assembled result is ~2,200–2,800 words of clean, structured markdown.

async function generateWorkplanMultiPass(
  brief: ProjectBrief | null,
  callText: string,
  additionalContext: string,
  wpStyleExamples: string,
): Promise<string> {

  const acronym     = brief?.acronym       || '[ACRONYM]'
  const title       = brief?.projectTitle  || '[PROJECT TITLE]'
  const technologies = (brief?.irisTechnologies || ['NIR spectroscopy', 'AI/ML']).join(', ')
  const trlStart    = brief?.trlStart ?? 3
  const trlEnd      = brief?.trlEnd   ?? 6
  const pilots      = (brief?.pilots   || []).join(', ') || '[pilot sites TBC]'
  const irisWPs     = (brief?.irisWPs  || []).join(', ') || '[TBC]'

  const partnerLines = (brief?.partners || [])
    .map(p => `- ${p.acronym} (${p.country}): ${p.type}, role=${p.role}${p.wps?.length ? ', WPs=' + p.wps.join('/') : ''}`)
    .join('\n') || '- [consortium TBC]'

  // ── Pass 1: structured JSON ─────────────────────────────────────────────────
  const pass1Prompt = `You are writing Horizon Europe Part B Section 3.1 Work Plan for project ${acronym}: "${title}".

CALL TOPIC (excerpt):
${callText.slice(0, 600)}

CONSORTIUM PARTNERS:
${partnerLines}

IRIS LEADS WPs: ${irisWPs}
IRIS TECHNOLOGIES: ${technologies}
TRL JOURNEY: TRL ${trlStart} → TRL ${trlEnd} by project end
PILOTS: ${pilots}

${additionalContext ? `WP OUTLINE PROVIDED BY CONSORTIUM:\n${additionalContext.slice(0, 2000)}\n\nUse this outline as the authoritative source. Do not deviate from any WP numbers, titles, or partner assignments given.` : 'No WP outline provided — generate a plausible 5-WP structure for a 48-month project.'}

Output ONLY valid JSON matching this exact schema (no preamble, no markdown fences):
{
  "overview": "<one paragraph 90–120 words: WP architecture, how WPs map onto project logic>",
  "duration": <total months, integer>,
  "workPackages": [
    {
      "number": 1,
      "title": "<WP title>",
      "lead": "<partner acronym or 'TBC'>",
      "participants": ["<acronym>", "..."],
      "personMonths": "<number or 'TBC'>",
      "startMonth": <integer>,
      "endMonth": <integer>,
      "objectives": "<1–2 sentences on WP objective>",
      "tasks": [
        {
          "id": "T1.1",
          "title": "<task name>",
          "lead": "<acronym or 'TBC'>",
          "partners": ["<acronym>", "..."],
          "description": "<2–3 sentences: what is done, how validated, output>"
        }
      ],
      "deliverables": [
        {"id": "D1.1", "title": "<title>", "type": "Report|Prototype|Dataset|Software|Other", "dissemination": "PU|CO|CI", "dueMonth": <integer>}
      ],
      "milestones": [
        {"id": "M1", "title": "<title>", "dueMonth": <integer>, "verification": "<how verified>"}
      ]
    }
  ],
  "risks": [
    {"risk": "<1-sentence description>", "wp": "WP1", "likelihood": "Low|Medium|High", "severity": "Low|Medium|High", "mitigation": "<mitigation measure>"}
  ]
}

Rules:
- Generate exactly 4–6 WPs; at least 2 tasks per WP; at least 1 deliverable per WP; at least 6 milestones total
- Include exactly 5 risks: one each for technical, partner/consortium, data/IP, regulatory, and market risk
- String values for unknown numbers must be "TBC" (not null, not 0)`

  let structured: any = { overview: '', workPackages: [], risks: [], duration: 48 }
  try {
    const p1 = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: pass1Prompt }],
      max_tokens: 3500,
      temperature: 0.3,
    })
    structured = JSON.parse(p1.choices[0].message.content || '{}')
    console.log(`Workplan Pass 1: ${(structured.workPackages || []).length} WPs, ${(structured.risks || []).length} risks`)
  } catch (e) {
    console.error('Workplan Pass 1 JSON parse failed:', e)
  }

  const wps: any[]   = structured.workPackages || []
  const risks: any[] = structured.risks        || []
  const duration: number = structured.duration ?? 48

  // ── Pass 2: prose descriptions per WP, in parallel ──────────────────────────
  const styleHint = wpStyleExamples
    ? `\n\nHorizon Europe IRIS task description examples (match this level of technical detail):\n${wpStyleExamples.slice(0, 1200)}`
    : ''

  const wpDescriptions: string[] = await Promise.all(
    wps.map(async (wp: any) => {
      const taskSummary = (wp.tasks || [])
        .map((t: any) => `${t.id} "${t.title}" (Lead: ${t.lead}): ${t.description}`)
        .join('\n')

      const wpPrompt = `Write the detailed prose description for WP${wp.number}: ${wp.title} in a Horizon Europe proposal for project ${acronym} (call topic: ${callText.slice(0, 200)}).

WP metadata:
- Lead: ${wp.lead} | Participants: ${(wp.participants || []).join(', ')} | Duration: M${wp.startMonth}–M${wp.endMonth} | PM: ${wp.personMonths}
- Objective: ${wp.objectives}
- Tasks:
${taskSummary}

Instructions:
- Write in first person plural ("we will", "our approach")
- Open with 1 italic metadata line: *Lead: ${wp.lead}; Participants: ${(wp.participants || []).join(', ')}; Duration: M${wp.startMonth}–M${wp.endMonth}; Person-months: ${wp.personMonths}*
- Then 1 sentence stating the WP objective
- Then for each task, write: **Task ${wp.number}.X: [title]** (Lead: PARTNER; Partners: A, B) on its own line, followed by 3–4 sentences of prose
- Reference IRIS technologies where applicable: ${technologies}
- Mention TRL progression from TRL ${trlStart} to TRL ${trlEnd} if it applies to this WP
- NO tables, NO additional headings, NO bullet lists (prose only)
- Maximum 480 words total — stop cleanly when done, do not pad${styleHint}`

      try {
        const wpRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: wpPrompt }],
          max_tokens: 700,
          temperature: 0.5,
          frequency_penalty: 0.7,
          presence_penalty: 0.5,
        })
        return wpRes.choices[0].message.content?.trim() || `[WP${wp.number} description to be completed by consortium]`
      } catch (e) {
        console.error(`Workplan Pass 2 WP${wp.number} failed:`, e)
        return `[WP${wp.number} description to be completed by consortium]`
      }
    })
  )

  // ── Assemble markdown ────────────────────────────────────────────────────────
  const md: string[] = []

  // Overview
  md.push(`### Work package overview\n\n${structured.overview || '[Work package overview to be completed by consortium]'}`)

  // WP list table
  const wpRows = wps.map((wp: any) =>
    `| WP${wp.number} | ${wp.title} | ${wp.lead} | ${wp.personMonths} | M${wp.startMonth} | M${wp.endMonth} |`
  ).join('\n')
  md.push(`### Work package list\n\n| WP no. | WP title | Lead beneficiary | Person-months | Start month | End month |\n|--------|----------|-----------------|---------------|-------------|----------|\n${wpRows || '| WP1 | [TBC] | [TBC] | [TBC] | M1 | M${duration} |'}`)

  // Deliverables table
  const allDels = wps.flatMap((wp: any) => (wp.deliverables || []).map((d: any) => ({ ...d, wpNum: wp.number })))
  const delRows = allDels.map((d: any) =>
    `| ${d.id} | ${d.title} | WP${d.wpNum} | TBC | ${d.type} | ${d.dissemination} | M${d.dueMonth} |`
  ).join('\n')
  md.push(`### Deliverables\n\n| D-no. | Deliverable title | WP | Lead | Type | Dissemination | Due month |\n|-------|------------------|----|------|------|---------------|-----------|\n${delRows || '| D1.1 | [TBC] | WP1 | [TBC] | Report | PU | M12 |'}`)

  // Milestones table
  const allMs = wps.flatMap((wp: any) => (wp.milestones || []).map((m: any) => ({ ...m, wpNum: wp.number })))
  const msRows = allMs.map((m: any) =>
    `| ${m.id} | ${m.title} | WP${m.wpNum} | M${m.dueMonth} | ${m.verification} |`
  ).join('\n')
  md.push(`### Milestones\n\n| M-no. | Milestone title | WP | Due month | Verification means |\n|-------|----------------|----|-----------|--------------------|\\n${msRows || '| M1 | [TBC] | WP1 | M12 | [TBC] |'}`)

  // WP descriptions
  if (wps.length > 0) {
    const wpSecs = wps.map((wp: any, i: number) =>
      `#### WP${wp.number}: ${wp.title}\n\n${wpDescriptions[i] || `[WP${wp.number} description to be completed]`}`
    ).join('\n\n')
    md.push(`### WP descriptions\n\n${wpSecs}`)
  }

  // Risks table
  const riskRows = risks.map((r: any) =>
    `| ${r.risk} | ${r.wp} | ${r.likelihood} | ${r.severity} | ${r.mitigation} |`
  ).join('\n')
  md.push(`### Critical risks and mitigation\n\n| Risk | WP | Likelihood | Severity | Mitigation measure |\n|------|----|------------|----------|--------------------|\n${riskRows || '| [TBC] | WP1 | Medium | Medium | [TBC] |'}`)

  // Person-month summary table
  const allPartners = [...new Set(wps.flatMap((wp: any) => [wp.lead, ...(wp.participants || [])]))]
    .filter(p => p && p !== 'TBC' && !p.includes('['))
  if (allPartners.length > 0 && wps.length > 0) {
    const hdr = `| Partner | ${wps.map((wp: any) => `WP${wp.number}`).join(' | ')} | **Total** |`
    const sep = `|---------|${wps.map(() => '-----').join('|')}|-----------|`
    const rows = allPartners.map(partner => {
      const cells = wps.map((wp: any) => {
        if (wp.lead === partner) return 'TBC-L'
        if ((wp.participants || []).includes(partner)) return 'TBC'
        return '—'
      })
      return `| ${partner} | ${cells.join(' | ')} | TBC |`
    })
    md.push(`### Person-month summary\n\n${hdr}\n${sep}\n${rows.join('\n')}`)
  }

  return md.join('\n\n')
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    let body: any = {}
    try {
      body = await req.json()
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { section, additionalContext, outputType, generatedText } = body
    const existingDraft: string = typeof body.existingDraft === 'string' ? body.existingDraft : ''
    const pageLimit: number = typeof body.pageLimit === 'number' && body.pageLimit >= 1 ? Math.min(body.pageLimit, 20) : 2
    const sessionSections: Record<string, string> = body.sessionSections && typeof body.sessionSections === 'object' ? body.sessionSections : {}
    const brief: ProjectBrief | null = body.brief || null
    const template: ProposalTemplate | null = body.template || null
    let { callText } = body

    if (!section || !callText?.trim()) {
      return NextResponse.json({ error: 'section and callText are required' }, { status: 400 })
    }

    // Normalize section ID: if a numeric/title ID like "1.2" was sent, resolve it
    // against the template's section list to get the canonical string ID (e.g. "sota")
    let normalizedSection: string = section
    if (template?.sections) {
      const match = template.sections.find(
        (s: any) => s.id === section || s.title === section || s.title?.startsWith(section + ' ')
      )
      if (match && match.id !== section) {
        console.log(`Section ID normalised: "${section}" → "${match.id}"`)
        normalizedSection = match.id
      }
    }

    // ── DOCX download — skip re-generation, build from provided text ──────────
    if (outputType === 'docx' && generatedText) {
      const label = SECTION_LABELS[section] || section
      const buffer = await buildDocxFromText(label, callText, generatedText)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="IRIS_Proposal_${section}.docx"`,
        }
      })
    }

    // ── Auto-expand Horizon Europe call identifiers ───────────────────────────
    const originalCallText = callText
    const wasCallId = isCallIdentifier(callText)
    if (wasCallId) {
      console.log(`Call ID detected: ${callText} — fetching from EU F&T API...`)
      let resolved = await fetchCallDetails(callText)
      if (!resolved) {
        console.log('EU F&T API returned nothing — trying Tavily call fallback...')
        resolved = await fetchCallFromTavily(callText)
      }
      if (resolved) {
        console.log(`Call details resolved (${resolved.length} chars)`)
        // Strip call identifier tokens so the model does not echo them in output
        callText = resolved.replace(/\bHORIZON(?:[-\s][A-Z0-9]+)+\b/gi, '[this call]').trim()
      } else {
        console.log('Could not resolve call ID — using identifier as-is')
      }
    }

    // ── Derive keyword source for academic searches ───────────────────────────
    // For resolved call IDs: extract the objective/scope section of the resolved text.
    // For pasted free text: use the original input directly.
    // Fall back to additionalContext if both are unavailable.
    let keywordSource: string
    let keywordSourceLabel: string
    if (wasCallId && callText !== originalCallText) {
      const match = callText.match(/(?:objective|scope|focus)[:\s]+([^\n]{1,200})/i)
      if (match) {
        keywordSource = match[1]
        keywordSourceLabel = 'resolved objective/scope match'
      } else if (additionalContext?.trim()) {
        keywordSource = additionalContext
        keywordSourceLabel = 'additionalContext fallback'
      } else {
        keywordSource = callText.slice(0, 300)
        keywordSourceLabel = 'resolved call text (first 300 chars)'
      }
    } else {
      keywordSource = originalCallText || callText.slice(0, 300)
      keywordSourceLabel = 'original user input'
    }
    if (!keywordSource.trim()) {
      keywordSource = callText.slice(0, 300)
      keywordSourceLabel = 'emergency fallback to callText'
    }
    console.log(`[keywords] source: ${keywordSourceLabel}`)

    // ── Generation path ───────────────────────────────────────────────────────
    const mode = SECTION_MODE[normalizedSection as keyof typeof SECTION_MODE] || 'INTERNAL'
    const fullQuery = [callText, additionalContext].filter(Boolean).join('\n\n')
    console.log(`Proposal [${section}→${normalizedSection}] mode=${mode}`)

    // Workplan sections: skip KB content retrieval (prevents wrong-project contamination).
    // The WP style examples block below provides format/style from the KB separately.
    const isWorkplanSection = normalizedSection === 'workplan' || normalizedSection === 'implementation'

    // Run retrieval in parallel where possible
    const [[internalCtx, kbSourceBlock], externalCtx, styleCtx] = await Promise.all([
      (mode === 'INTERNAL' || mode === 'HYBRID') && !isWorkplanSection
        ? retrieveInternalContext(
            section,
            fullQuery,
            mode === 'HYBRID' ? (additionalContext || '') : undefined
          )
        : Promise.resolve(['', ''] as [string, string]),
      mode === 'EXTERNAL' || mode === 'HYBRID'
        ? retrieveExternalContext(fullQuery, keywordSource)
        : Promise.resolve(''),
      retrieveStyleExamples(fullQuery)
    ])

    // Assemble context blocks
    const contextBlocks: string[] = []
    if (internalCtx) contextBlocks.push(`=== IRIS KNOWLEDGE BASE ===\n${internalCtx}`)
    if (externalCtx) contextBlocks.push(`=== EXTERNAL RESEARCH ===\n${externalCtx}`)

    // ── Project facts block — injected into EVERY section prompt ─────────────
    // This is the single source of truth for project identity. Without it,
    // sections invent different project names (CIRCULAR FoodPack, SORT4CIRC…).
    const briefContext = brief ? `
╔══════════════════════════════════════════════════════════╗
║  PROJECT IDENTITY — DO NOT DEVIATE FROM THESE FACTS     ║
╚══════════════════════════════════════════════════════════╝
Project title:  ${brief.projectTitle}
Acronym:        ${brief.acronym}
Core innovation: ${brief.coreInnovation}
Why beyond SotA: ${brief.whyBeyondSotA}
IRIS technologies: ${(brief.irisTechnologies || []).join(', ')}
IRIS role:      ${brief.irisRole}
TRL journey:    TRL ${brief.trlStart} → TRL ${brief.trlEnd}
Pilots / sectors: ${(brief.pilots || []).join(', ')}
Partners:       ${(brief.partners || []).map((p: any) => `${p.acronym} (${p.country}, ${p.role})`).join(' | ')}
Call scope:     ${brief.scopeSelected}

ABSOLUTE RULE: The project described in every output sentence MUST match the above facts.
NEVER use a different project name, acronym, or description — even if retrieved chunks mention other EU projects.
If retrieved context mentions CIRCULAR FoodPack, SORT4CIRC, PHOTONFOOD, PRESERVE, or any other prior project — use those only as structural EXAMPLES or ANALOGIES, never as the project being described.
`.trim() : ''

    // ── Section-specific instructions ────────────────────────────────────────
    const SECTION_INSTRUCTIONS: Record<string, string> = {
      objectives: `Structure as follows:\nPARAGRAPH 1 (3-4 sentences): Establish the problem and opportunity. What is the industrial/societal challenge this project addresses? Why is it urgent now? What does the call specifically seek to solve? Do NOT start with "The [ACRONYM] project will...".\n\nPARAGRAPH 2 onwards: State each objective as a short declarative sentence followed by the measurable target or validation approach. Use transitions: "A first objective is to...", "We will further...", "A third objective concerns...". Never use "Objective 1:", "Objective 2:" as labels. Maximum 400 words total.\n\nWrite specific, measurable project objectives in first person plural. Use 4-6 objectives, each introduced with a short declarative sentence then expanded with technical detail and measurable targets. Each objective must map to a named call expected outcome. State the TRL journey explicitly: starting at TRL ${brief?.trlStart ?? '?'}, achieving TRL ${brief?.trlEnd ?? '?'} by project end. This section covers ONLY project objectives — do not include impact, dissemination, or market content.\n\nSCOPE BOUNDARY: Cover ONLY the project's technical and scientific objectives. Do NOT include: publications targets, open access plans, commercialisation pathways, market size figures, workforce impact, standardisation activities, societal impact. Those sections exist separately. Stay within 400 words.`,
      sota: `Write a rigorous, evidence-grounded State of the Art section structured as FIVE sub-sections with ### headings. Do NOT emit any section number — the number will be added automatically.

### Current landscape
2–3 short paragraphs (max 120 words each). Name specific methods, tools, commercial platforms, and research groups from the provided sources. Every claim must name a source, company, or measurement — no generic statements.

### Recent advances
2–3 paragraphs citing specific results and metrics from the retrieved papers. For each advance: name the authors/group, the year, the methodology, and the measured outcome (e.g. accuracy %, throughput, cost reduction). Use numbered inline citations [N] from the numbered source list provided.

### Gaps in the state of the art
Use - bullet points (NOT ■). Write 4–6 gap bullets, each 2–3 sentences: describe the gap, name the specific limitation or missing capability, cite the source that evidences it. Do not write vague bullets like "lacks scalability" — be specific about what is missing and why it matters.

### Why this research is necessary and timely
1–2 paragraphs explaining the urgency and opportunity window. Reference specific policy drivers, market data, or EU priorities from the sources.

### Progress beyond the state of the art
A structured comparison. Write a brief intro sentence, then a markdown table with three columns: **Current SotA** | **This project's advance** | **Target KPI / metric**. Include 3–5 rows covering the key technological leaps. After the table, one closing sentence on the strategic impact.

IMPORTANT CONSTRAINTS:
- Sub-section ### headings are required — do not omit them
- Use - for all bullet points, never ■
- Maximum paragraph length: 130 words — if a paragraph exceeds this, split it
- Use numbered inline citations [N] matching the numbered source list — e.g. [1], [2], [1,3]
- Do not mention the project acronym or the call identifier in this section
- Do not open with a sentence about the EU programme or Horizon Europe
- Total length must be 1,800–2,200 words`,
      innovation: `Focus on what is genuinely novel — not incremental improvement but breakthrough potential. Compare explicitly to existing approaches and state what they cannot do. Ground in IRIS's demonstrated capabilities from the KB context.`,
      consortium: `Write one paragraph per partner (4-6 sentences each). For each partner: name, country, type, specific expertise, role in this project, and why they are the best choice for that role. Do not use bullet points — flowing prose per partner. Close with a paragraph on consortium complementarity and geographic spread.`,
      business_case: `Structure as: market context → IRIS's commercial pathway → partner exploitation routes → investment and revenue model → timeline to market. Reference specific sectors: ${(brief?.pilots || []).join(', ')}. Be specific about who will buy what — avoid generic statements.`,
      workplan: `Write a complete Horizon Europe Part B Section 3.1 Work Plan. Structure EXACTLY as follows, using these ### headings:

### Work package overview
One paragraph (100–150 words) explaining the overall WP architecture and how the WPs map onto the project logic. Reference the number of WPs and their thematic grouping.

### Work package list
A markdown table with columns: **WP no.** | **WP title** | **Lead beneficiary** | **Person-months** | **Start month** | **End month**. Include ALL work packages. If exact person-months are not provided, write [TBC].

### Deliverables
A markdown table with columns: **D-no.** | **Deliverable title** | **WP** | **Lead** | **Type** | **Dissemination** | **Due month**. Include at least one deliverable per WP. If not provided, generate plausible deliverables consistent with the WP descriptions and mark with *[draft]*.

### Milestones
A markdown table with columns: **M-no.** | **Milestone title** | **WP** | **Due month** | **Verification means**. Include at least 3 milestones. Mark with *[draft]* if not specified by the consortium.

### WP descriptions
For each WP, write a sub-section with heading **#### WP[N]: [Title]** containing:
- Lead: [partner]; Participants: [list]; Duration: M[X]–M[Y]; Person-months: [N] — in italics as the opening line
- Objectives (1–2 sentences)
- Tasks — use **Task N.X: [name]** (Lead: PARTNER; Partners: A, B) format followed by 3–4 sentences describing what will be done, how it will be validated, and what the output is
- Deliverables and milestones from this WP (reference D-no. and M-no.)

### Critical risks and mitigation
A markdown table with columns: **Risk** | **WP** | **Likelihood** | **Severity** | **Mitigation measure**. Include at least 5 risks covering: technical, data/IP, partner, regulatory, and market risks.

### Person-month summary
A markdown table: partners as rows, WP numbers as columns, total column. Fill from provided data; use [TBC] where not specified.

RULES:
- Use ONLY partner names, WP titles, task descriptions, deliverable numbers, and person-month figures that are explicitly provided in the brief or additional context
- Where data is missing, write [TO BE COMPLETED BY CONSORTIUM] — do NOT invent figures
- Use first person plural for IRIS tasks; describe other partners' tasks in third person
- Use **Task X.Y: [name]** (Lead: PARTNER; Partners: A, B) bold task labels throughout WP descriptions
- The partners in this consortium are: ${(brief?.partners || []).map((p: any) => `${p.acronym} (${p.country})`).join(', ') || '[see brief]'}
- IRIS leads the following WPs: ${(brief?.irisWPs || []).join(', ') || '[see brief]'}
- Total project duration: infer from call or brief; default to 48 months if not specified`,
      management: `Write Section 3.2 Management Structure with the following ### headings:

### Governance structure
Describe the decision-making hierarchy: Project Steering Committee (PSC) as the supreme body with one vote per partner; Technical Management Committee (TMC) chaired by the Project Coordinator for operational decisions; an optional External Advisory Board (EAB) for independent scientific review. Name the roles explicitly: Project Coordinator (PC), Work Package Leaders (WPLs), Task Leaders. One paragraph per body.

### Decision-making rules
State quorum requirements, voting thresholds, escalation paths, and frequency of meetings (PSC: every 6 months; TMC: monthly). Explain how deadlocks are resolved.

### Risk management
A markdown table with at least 6 risks: | Risk | WP | Likelihood | Severity | Mitigation | Contingency |. Cover: technical, schedule, partner/consortium, data management, IP, and external risks.

### Quality assurance
Describe the QA framework: internal peer review of deliverables, 2-week review window before submission, sign-off by WPL and PC. Name the quality metrics tracked and frequency.

### Data management
One paragraph: data management plan reference, open access policy (at least 60% of publications open access), dataset repositories (Zenodo / EU Open Research), and IP assignment rules.

Do NOT write a generic paragraph — every sentence must name a specific role, body, rule, or metric.`,

      iris_role: `Write one paragraph per partner (4-6 sentences). For IRIS: start with the WP leadership, name the specific tasks IRIS leads, name the IRIS technologies being deployed, reference 1-2 previous IRIS projects as evidence of capability. For each other partner: organisation type, country, specific expertise, role in this project, and why they are the best choice. Close with a paragraph on consortium complementarity — how the partners collectively cover the full value chain from research to demonstration to market. Write in first person plural for IRIS tasks, third person for other partners' descriptions. Do not use bullet points.`,

      // 1.3 Methodology — research phases + Gantt description + risk table + TRL
      methodology: `Write Section 1.3 Methodology structured as follows:

### Research design
1 paragraph (100 words): explain the overall approach — what type of research this is (applied/experimental/pilot), how the work is organised into phases that map to WPs, and how the approach ensures reproducibility and validation.

### Technical approach
For each research phase (Phase 1: Foundation, Phase 2: Development, Phase 3: Validation/Pilots), write one sub-section with:
- **Phase N: [Name]** (TRL ${brief?.trlStart ?? '?'} → TRL X, months M1–MY)
- 2–3 sentences on the specific activities
- Lead partner and contributing partners (IRIS leads phases involving NIR/spectroscopy)
- Key technical challenge and mitigation

Reference specific IRIS technologies: ${(brief?.irisTechnologies || ['NIR spectroscopy', 'AI/ML']).join(', ')}.
For pilot demonstrations: ${(brief?.pilots || []).join(', ')}.

### Risk assessment
A markdown table with at least 5 technical risks: | Risk | Phase | Likelihood | Severity | Mitigation measure |

### Timeline (Gantt description)
A markdown table showing work packages against months: | WP | Lead | M1-M6 | M7-M12 | M13-M18 | M19-M24 | M25-M30 | M31-M36 | etc. Use ●●● for active periods. If duration is 48 months, extend columns accordingly.

### TRL progression
1 paragraph explicitly stating: starting TRL is ${brief?.trlStart ?? '?'}, end-of-project TRL target is ${brief?.trlEnd ?? '?'}. Describe what must be demonstrated at each pilot site to reach that TRL, referencing the Technology Readiness Level definitions.`,

      // 2.1 Expected outcomes — KPI mapping table per call outcome
      outcomes: `Do NOT open with a project summary or preamble paragraph. Start immediately with the first outcome: "A primary outcome of the project is...". Do NOT close with a TRL summary paragraph — that belongs in Section 1.1.

Write Section 2.1 Expected Outcomes and Impacts structured as:

### Contribution to call expected outcomes
For each call expected outcome listed in the call text, write:
- One sentence stating what the project delivers toward that outcome
- One sentence quantifying the contribution (specific metric + reasoning: "based on X, we project Y%")
- One sentence naming the pilot/demonstration context

Then write a markdown table: | Call expected outcome | Project contribution | Target KPI | Measurement method | Timeline |

### Scientific and technological impact
2 paragraphs covering: publications (target number and open-access plan), datasets, software, patents or IP anticipated. Use specific targets: "We target X peer-reviewed publications, of which ≥60% open access via Zenodo."

### Economic impact
2 paragraphs: market opportunity (specific market size and growth rate from the call or context), revenue model for IRIS and partners, timeline to commercialisation, job creation estimate.

### Societal and environmental impact
1 paragraph: sustainability benefits (quantified where possible), workforce upskilling, regulatory contribution.

Hard maximum: 1,600 words. Do not include task descriptions, methodology, or consortium detail.`,

      // 2.2 Dissemination — Communication/Dissemination/Exploitation table
      dissemination: `Write Section 2.2 Dissemination, Exploitation and Communication structured as follows:

### Dissemination plan
A markdown table: | Activity | Target audience | Channel | Frequency | Lead partner | KPI |
Include: peer-reviewed publications (target N), conference presentations (target N conferences), workshops, open datasets, policy briefs.

### Exploitation strategy
One paragraph per partner describing their exploitation pathway: what they will do with the results post-project, through which channel (product, service, licensing, standardisation), and on what timeline. Use "Partner X will exploit..." third person for others, first person for IRIS.

### Communication and outreach
A markdown table: | Activity | Target audience | Channel | Timing | Reach target |
Include: project website, social media (LinkedIn, Twitter), press releases, infographics, stakeholder events, EU project database (CORDIS).

### Intellectual property management
1 paragraph: background IP ownership, foreground IP assignment rules, joint IP procedures, and how conflicts are resolved.

### Standardisation activities
1 sentence: name any standards bodies (ISO, CEN, ETSI) relevant to the technology and whether participation is planned.`,
    }

    const sectionInstruction = SECTION_INSTRUCTIONS[normalizedSection] || SECTION_INSTRUCTIONS[section] || ''

    // ── Length from template or pageLimit ────────────────────────────────────
    const sectionTemplate = template?.sections.find(s => s.id === section)
    const targetWords = sectionTemplate?.words ?? (pageLimit * 400)
    const targetPages = sectionTemplate?.pages ?? pageLimit
    const minWords = Math.round(targetWords * 0.85)
    const maxWords = Math.round(targetWords * 1.1)

    // Build system prompt
    const styleHint = styleCtx
      ? `\n\nExamples of IRIS proposal writing style to emulate:\n\n${styleCtx.slice(0, 1500)}`
      : ''

    const priorSectionsEntries = Object.entries(sessionSections).filter(([k]) => k !== section)
    const priorSectionsBlock = priorSectionsEntries.length > 0
      ? `PREVIOUSLY WRITTEN SECTIONS FOR THIS PROPOSAL:\n\n${
          priorSectionsEntries
            .map(([k, text]) => {
              // Strip internal scaffolding and KB sources before injecting as prior-section context
              const clean = text
                .split('<<<KB_SOURCES>>>')[0]
                .split('---\n**References**')[0]
                .split('---\n**KB Sources**')[0]
                .trim()
              return `[${k.toUpperCase().replace(/_/g, ' ')}]\n${clean.slice(0, 1200)}`
            })
            .join('\n\n')
        }\n\nCRITICAL: The section you are about to write must be consistent with the sections above. Do not repeat content already covered. Cross-reference where relevant.\n\n`
      : ''

    const systemPrompt = `${priorSectionsBlock}You are an expert EU Horizon Europe proposal writer for IRIS Technology Solutions — a photonics and NIR spectroscopy SME in Barcelona with ~60 staff and 15+ active Horizon Europe projects.

IRIS's core technologies: NIR spectroscopy, hyperspectral imaging (HSI), Raman spectroscopy, LIBS, process analytical technology (PAT), AI/ML for spectral data, IoT sensor networks, digital platforms (Scadalytics, VISUM, PATBox).
${briefContext ? `\n${briefContext}\n` : ''}
TARGET LENGTH: ${targetPages} page(s) of academic prose.
Write between ${minWords} and ${maxWords} words.
MINIMUM ${minWords} words — do not stop early.
Every paragraph must add new specific technical content — do not repeat points already made.
Do not pad with generic conclusions — if you have covered all points from the sources, add another gap bullet or expand an existing advance with more detail from the provided context.
${sectionInstruction ? `\nSECTION-SPECIFIC INSTRUCTIONS:\n${sectionInstruction}\n` : ''}
Writing style rules (follow the provided style examples):
- Write in flowing academic prose — no bullet points, no numbered lists (exception: task labels in methodology/workplan per TASK DESCRIPTIONS below)
- Technical, precise, confident register appropriate for EU evaluators
- Paragraph structure: topic sentence → evidence/elaboration → implication
- Use active voice where possible
- Cite specific technologies, metrics, and project names where available in context

${MODE_INSTRUCTION[mode]}

Do not invent facts not present in the provided context.
End with a clear forward-looking statement that creates momentum toward the proposed project.

LANGUAGE DISCIPLINE: Never use "significant", "various", "several", "many", "notable", "substantial", "key challenges", "further exacerbate" or similar vague intensifiers without a specific quantity or named source immediately following. Replace every vague descriptor with a specific figure, named entity, or measurement.

LENGTH DISCIPLINE: The section MUST reach the minimum word count stated above. If you have covered all points from the sources, add another gap bullet or expand an advance with more detail from the context. Stopping early is a failure — evaluators penalise short sections.${styleHint}`

    // ── Existing draft injection ──────────────────────────────────────────────
    let enrichedSystemPrompt = existingDraft
      ? `EXISTING DRAFT FOR THIS SECTION:\nThe user has an existing draft for this section. Use it as the structural foundation — keep all WP numbers, task numbers, partner names, deliverable numbers and months exactly as given. Expand the task descriptions to match the detail level of the style examples provided.\n\n${existingDraft}\n\n${systemPrompt}`
      : systemPrompt

    // ── WP style examples (workplan only) — captured for multi-pass ──────────
    let wpStyleExamples = ''
    if (isWorkplanSection) {
      try {
        const wpStyleQuery = `work package task description lead partners deliverables months`
        const wpEmbedding = await embedBatch([wpStyleQuery])
        const wpExamples = await searchChunks(wpEmbedding[0], wpStyleQuery, 8)
        wpStyleExamples = wpExamples
          .filter((c: any) =>
            /T\d+\.\d+|Task \d+\.\d+/i.test(c.content) &&
            /Lead:|Partners:/i.test(c.content) &&
            c.content.length > 500
          )
          .slice(0, 3)
          .map((c: any) => c.content)
          .join('\n\n---\n\n')
      } catch (e) {
        console.warn('WP style retrieval failed (non-fatal):', e)
      }
    }

    let finalSystemPrompt = enrichedSystemPrompt + STYLE_ENFORCEMENT

    if (['objectives', 'outcomes'].includes(section)) {
      const hardLimit = section === 'objectives' ? 400 : 800
      finalSystemPrompt += `\n\nHARD STOP: This section must be UNDER ${hardLimit} words. Count your words as you write. Stop immediately when you reach ${hardLimit} words. Do not cover dissemination, commercialisation, societal impact, or scientific publications in this section — those belong in later sections.`
    }

    // Parse source papers for post-generation citation validation
    const sourcePapers = parseSourcePapers(externalCtx)
    console.log(`Citation validation: ${sourcePapers.length} source papers parsed from external context`)
    console.log(`Source papers with DOIs: ${sourcePapers.filter(p => p.url).length}/${sourcePapers.length}`)

    // ── Workplan: multi-pass generation path ─────────────────────────────────
    // Two-pass approach prevents the degenerate synonym loops seen with single-call
    // generation at 2800+ word targets. Pass 1 = structured JSON tables, Pass 2 =
    // per-WP prose (~450 words each, parallel), assembled into clean markdown.
    const isSotASection = normalizedSection === 'state_of_the_art' || normalizedSection === 'innovation' || normalizedSection === 'sota'
    // isWorkplanSection is already declared above

    if (isWorkplanSection) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            let wpText = await generateWorkplanMultiPass(brief, callText, additionalContext || '', wpStyleExamples)
            wpText = convertLatexToMarkdown(wpText)

            // n-gram deduplication (8-word windows)
            const words = wpText.split(/\s+/)
            if (words.length > 100) {
              const gramCounts = new Map<string, number>()
              for (let j = 0; j <= words.length - 8; j++) {
                const gram = words.slice(j, j + 8).join(' ').toLowerCase()
                gramCounts.set(gram, (gramCounts.get(gram) || 0) + 1)
              }
              const maxGram = gramCounts.size > 0 ? Math.max(...gramCounts.values()) : 0
              if (maxGram > 3) {
                console.warn(`Workplan n-gram loop detected (max=${maxGram}) — truncating at first repeat`)
                // Find the position of the first repeated gram beyond its 2nd occurrence
                const seen2 = new Map<string, number>()
                let cutWord = words.length
                for (let j = 0; j <= words.length - 8; j++) {
                  const gram = words.slice(j, j + 8).join(' ').toLowerCase()
                  const count = (seen2.get(gram) || 0) + 1
                  seen2.set(gram, count)
                  if (count > 2) { cutWord = j; break }
                }
                wpText = words.slice(0, cutWord).join(' ')
              }
            }

            controller.enqueue(encoder.encode(wpText))
            if (kbSourceBlock) {
              controller.enqueue(encoder.encode(`\n\n<<<KB_SOURCES>>>\n${kbSourceBlock}`))
            }
          } catch (e: any) {
            console.error('Workplan multi-pass error:', e)
            controller.enqueue(encoder.encode(`Generation error: ${e.message}. Please regenerate.`))
          } finally {
            controller.close()
          }
        }
      })
      return new NextResponse(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    // ── Stream response ───────────────────────────────────────────────────────

    // For SotA sections, prepend a numbered source list so the model can cite [N] inline
    const numberedSourceList = (isSotASection && sourcePapers.length > 0)
      ? `NUMBERED SOURCE LIST (use [N] for inline citations):\n${sourcePapers.slice(0, 15).map((p, i) => `[${i + 1}] ${p.authors} (${p.year}). ${p.title}.${p.url ? ' ' + p.url : ''}`).join('\n')}\n`
      : ''

    const userMessage = [
      `Call topic / objectives:\n${callText}`,
      additionalContext ? `Additional context:\n${additionalContext}` : '',
      numberedSourceList,
      contextBlocks.join('\n\n'),
      `Write the ${SECTION_LABELS[section] || section} section:`
    ].filter(Boolean).join('\n\n')
    // Workplan: always use the base gpt-4o — fine-tuned models trained on SotA data
    // loop badly on structured table/WP content. SotA uses the fine-tuned model.
    const model = isWorkplanSection
      ? 'gpt-4o'
      : isSotASection
        ? (process.env.IRIS_SOTA_MODEL || process.env.IRIS_PROPOSAL_MODEL || 'gpt-4o')
        : (process.env.IRIS_PROPOSAL_MODEL || 'gpt-4o')
    console.log(`Proposal model: ${model} (section: ${section})`)
    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      max_tokens: isWorkplanSection ? 4500 : isSotASection ? 3500 : 2000,
      temperature: isWorkplanSection ? 0.5 : 0.4,
      frequency_penalty: isWorkplanSection ? 0.7 : 0.6,
      presence_penalty:  isWorkplanSection ? 0.4 : 0.4,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Buffer full generated text before any post-processing so we can
          // replace it with a cleaned version if unverified citations are found.
          let fullGeneratedText = ''
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) fullGeneratedText += delta
          }

          // ── Post-processing: normalize section number and bullet style ──────
          // Strip any leading section number the model emitted (e.g. "1.1.1 State…", "1.2 State…")
          fullGeneratedText = fullGeneratedText.replace(/^\s*\d+(\.\d+)*\s+[A-Z][^\n]*\n/, '')
          // Replace Unicode black-square bullets with standard markdown dashes
          fullGeneratedText = fullGeneratedText.replace(/■\s*/g, '- ')

          // ── Deduplication guard — n-gram windowing (8-word) + unique-token ratio
          {
            const words = fullGeneratedText.split(/\s+/)
            if (words.length > 80) {
              // Unique-token ratio check: catches synonym spirals (each word unique but highly repetitive in concept)
              const uniqueTokens = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean))
              const uniqueRatio = uniqueTokens.size / words.length
              if (uniqueRatio < 0.30) {
                console.warn(`Low unique-token ratio (${uniqueRatio.toFixed(2)}) — truncating degenerate output`)
                // Find last heading or paragraph break before degeneration starts
                const cutIdx = fullGeneratedText.lastIndexOf('\n\n', Math.floor(fullGeneratedText.length * 0.4))
                fullGeneratedText = cutIdx > 100
                  ? fullGeneratedText.slice(0, cutIdx) + '\n\n*[Draft incomplete — generation quality degraded. Please regenerate.]*'
                  : '*[Generation quality degraded — please regenerate this section.]*'
              } else {
                // N-gram windowing (8-word): catches verbatim sentence repeats
                const gramCounts = new Map<string, number>()
                for (let j = 0; j <= words.length - 8; j++) {
                  const gram = words.slice(j, j + 8).join(' ').toLowerCase()
                  gramCounts.set(gram, (gramCounts.get(gram) || 0) + 1)
                }
                const maxGram = gramCounts.size > 0 ? Math.max(...gramCounts.values()) : 0
                if (maxGram > 4) {
                  console.warn(`N-gram loop detected (max=${maxGram}) — truncating at first repeat`)
                  const seen2 = new Map<string, number>()
                  let cutWord = words.length
                  for (let j = 0; j <= words.length - 8; j++) {
                    const gram = words.slice(j, j + 8).join(' ').toLowerCase()
                    const cnt = (seen2.get(gram) || 0) + 1
                    seen2.set(gram, cnt)
                    if (cnt > 2) { cutWord = j; break }
                  }
                  fullGeneratedText = words.slice(0, cutWord).join(' ')
                    + '\n\n*[Draft truncated at detected repetition — please regenerate.]*'
                }
              }
            }
          }

          // ── Citation injection (SotA/EXTERNAL only) — always run to add [N] refs ──
          if (isSotASection && sourcePapers.length > 0) {
            const existingCites = (fullGeneratedText.match(/\[\d+\]/g) || []).length
            if (existingCites < 3) {
              console.log(`Citation injection: ${existingCites} [N] citations found, injecting from ${sourcePapers.length} source papers`)
              const sourceList = sourcePapers.slice(0, 15).map((p, i) =>
                `[${i + 1}] ${p.authors} (${p.year}). ${p.title}.${p.url ? ' ' + p.url : ''}`
              ).join('\n')
              const injectionPrompt = `You are a citation editor working on a Horizon Europe proposal. The text below contains factual claims about the state of the art. Add numbered inline citations [N] where claims are supported by the source papers listed.

Rules:
- Use [N] format (e.g. [1], [2], [1,3]) matching the source paper numbers below
- Add citations at the END of the sentence or clause they support, before the full stop
- Only cite where the claim clearly relates to that paper's topic or findings
- Add citations to at least 40% of sentences that make factual claims
- Do not cite general transition sentences ("however", "in summary", etc.)
- Do not invent citations — only use numbers [1]–[${sourcePapers.slice(0, 15).length}]
- Do not change any other words in the text
- Return the complete text with [N] citations inserted

SOURCE PAPERS:
${sourceList}

TEXT:
${fullGeneratedText}`
              try {
                const injectRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
                  body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: injectionPrompt }], temperature: 0, max_tokens: 4000 }),
                  signal: AbortSignal.timeout(30000),
                })
                const injectData = await injectRes.json()
                const injected = injectData.choices?.[0]?.message?.content?.trim()
                if (injected && injected.length > fullGeneratedText.length * 0.8) {
                  fullGeneratedText = injected
                  console.log(`Citation injection complete: ${existingCites} → ${(fullGeneratedText.match(/\[\d+\]/g) || []).length} citations`)
                }
              } catch (e) {
                console.error('Citation injection error (non-fatal):', e)
              }
            }
          }

          // ── Citation validation ─────────────────────────────────────────────
          const { valid, invalid } = validateCitations(fullGeneratedText, sourcePapers)
          console.log(`Citations: ${valid.length} verified, ${invalid.length} unverified`)

          // ── Cleanup pass — remove unverified citations from text ────────────
          let finalText = fullGeneratedText
          if (invalid.length > 0) {
            console.log(`Removing ${invalid.length} unverified citations from text...`)
            const cleanupPrompt = `The following citations in this text could not be verified against retrieved sources and must be removed: ${invalid.join(', ')}

For each unverified citation:
1. Remove the citation marker (Author, Year) from the sentence
2. If the sentence still makes sense without the citation — keep it as an uncited claim
3. If the entire sentence depends on that citation for its credibility — rephrase it as a general observation without specific attribution
4. Do NOT replace with a different citation
5. Do NOT invent new citations

Return the cleaned text only. No explanation.

Text to clean:
${fullGeneratedText}`

            try {
              const cleanRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [{ role: 'user', content: cleanupPrompt }],
                  temperature: 0,
                  max_tokens: 3000,
                }),
                signal: AbortSignal.timeout(30000),
              })
              const cleanData = await cleanRes.json()
              const cleaned = cleanData.choices?.[0]?.message?.content?.trim()
              if (cleaned) {
                finalText = cleaned
                console.log(`Cleanup complete: ${fullGeneratedText.length} → ${finalText.length} chars`)
              }
            } catch (e) {
              console.error('Citation cleanup error (using original text):', e)
            }
          }

          // Stream the (potentially cleaned) main text
          controller.enqueue(encoder.encode(finalText))

          // ── Reference block (external sources) ─────────────────────────────
          const referenceList = await extractAndFormatReferences(finalText, sourcePapers)
          if (referenceList) {
            controller.enqueue(encoder.encode(`\n\n---\n**References**\n\n${referenceList}`))
          }

          // ── KB Sources block — sent with a sentinel the frontend splits on ──
          // The frontend strips this from the editable draft and shows it as a
          // read-only collapsible panel, so internal file paths don't leak into exports.
          if (kbSourceBlock) {
            controller.enqueue(encoder.encode(`\n\n<<<KB_SOURCES>>>\n${kbSourceBlock}`))
          }

          // ── Validation status line ──────────────────────────────────────────
          const validationLine = invalid.length > 0
            ? `\n\n✓ ${valid.length} citation${valid.length !== 1 ? 's' : ''} verified. ${invalid.length} unverified citation${invalid.length !== 1 ? 's' : ''} removed from text.`
            : valid.length > 0
              ? `\n\n✓ All ${valid.length} citation${valid.length !== 1 ? 's' : ''} verified against retrieved sources.`
              : ''
          if (validationLine) {
            controller.enqueue(encoder.encode(validationLine))
          }
        } finally {
          controller.close()
        }
      }
    })

    return new NextResponse(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })

  } catch (e: any) {
    console.error('Proposal route error:', e)
    return NextResponse.json({ error: e.message || 'Generation failed' }, { status: 500 })
  }
}
