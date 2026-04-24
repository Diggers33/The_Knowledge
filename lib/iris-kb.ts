/**
 * IRIS KB — Shared utilities
 * Used by both /api/chat/route.ts and /api/generate/route.ts
 * Place at: lib/iris-kb.ts
 */

import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── FILTERED CHUNK SEARCH ───────────────────────────────────────────────────
// Uses search_rag_filtered RPC — applies project_tag index in SQL.
// Falls back to search_rag_hybrid (unfiltered) when no tags provided.

export async function searchChunks(
  embedding: number[],
  queryText: string,
  topK = 20,
  projectTags?: string[]
): Promise<any[]> {
  if (projectTags && projectTags.length > 0) {
    const { data, error } = await supabase.rpc('search_rag_filtered', {
      query_embedding: embedding,
      query_text: queryText,
      filter_tags: projectTags,
      match_count: topK,
      similarity_threshold: 0.18
    })
    if (error) console.error('search_rag_filtered error:', error.message)
    const results = (data || []).filter((c: any) => c.similarity > 0.20)
    console.log(`search_rag_filtered [${projectTags.join(',')}]: ${results.length} chunks`)
    // If filter returns enough chunks, use them; otherwise fall back to unfiltered
    if (results.length >= 3) return results
    console.log('Filtered search too sparse — falling back to unfiltered')
  }

  const { data, error } = await supabase.rpc('search_rag_hybrid', {
    query_embedding: embedding,
    query_text: queryText,
    match_count: topK,
    similarity_threshold: 0.20
  })
  if (error) console.error('search_rag_hybrid error:', error.message)
  return (data || []).filter((c: any) => c.similarity > 0.22)
}

// ─── PROJECT TAG DETECTION ───────────────────────────────────────────────────
// Extracts project names from a query string.
// Matches: NANOBLOC, HYPERA, SORT4CIRC, BIO-UPTAKE, PRIM-ROCK etc.
// Used by both chat and generate routes.

const TAG_STOPWORDS = new Set([
  'IRIS','FOR','THE','AND','ARE','WAS','DID','HOW','WHAT','WERE','USED',
  'THAT','WITH','THIS','FROM','HAVE','BEEN','HAS','ITS','CAN','GET',
  'NEW','ALL','ANY','NOT','BUT','USE','OUR','YOU','WHO','WHY','ALSO',
  'TRL','PAT','NIR','MIR','HSI','LIBS','IOT','API','AI','ML','EU','SME',
  'WP','DOA','PDF','CAD','SOP','KPI','ROI','CEO','RD','IP','QA','QC',
  // Common query words that look like codes
  'MANY','DOES','HAVE','LIST','SHOW','TELL','GIVE','WHAT','WHICH','WHERE',
  'WHEN','WORK','WORKED','PROJECTS','PROJECT','PARTNERS','PARTNER','TECHNOLOGIES',
  'HORIZON','EUROPE','EUROPEAN','FUNDED','FUNDING','PROGRAMME','PROGRAM',
  'ABOUT','ACROSS','USING','USED','INTO','OVER','UNDER','BETWEEN','WITHIN',
  'RESULTS','METHODS','METHOD','SECTORS','SECTOR','APPLICATIONS','APPLICATION',
  'INCLUDE','INVOLVED','INVOLVEMENT','CAPABILITIES','CAPABILITY','EXPERIENCE',
  'COORDINATOR','COORDINATED','CONSORTIUM','MEMBER','PARTICIPANTS',
  'RESEARCH','DEVELOPMENT','INNOVATION','TECHNOLOGY','BASED','FOCUSED'
])

export function detectProjectTags(text: string): string[] {
  // Match fully uppercase tokens (NANOBLOC) AND mixed-case known patterns (Nanobloc → NANOBLOC)
  const candidates = text.match(/\b[A-Za-z][A-Z0-9a-z]{2,}(?:-[A-Za-z0-9]+)*\b/g) || []
  return [...new Set(
    candidates
      .map(c => c.toUpperCase())
      .filter(c => !TAG_STOPWORDS.has(c))
      // Must contain at least one digit or be all-caps to avoid common words
      .filter(c => /[0-9]/.test(c) || c === c.toUpperCase())
  )]
}



// ─── EMBEDDING ───────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: text, dimensions: 768 })
  })
  const data = await res.json()
  return data.data[0].embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: texts, dimensions: 768 })
  })
  const data = await res.json()
  return (data.data as any[]).sort((a, b) => a.index - b.index).map(d => d.embedding)
}

// ─── COHERE RERANKING ────────────────────────────────────────────────────────

export async function rerankChunks(query: string, chunks: any[]): Promise<any[]> {
  if (chunks.length === 0) return chunks
  try {
    const res = await fetch('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.COHERE_API_KEY}` },
      body: JSON.stringify({
        model: 'rerank-v3.5',
        query,
        documents: chunks.map((c: any) => (c.parent_text || c.chunk_text || '').slice(0, 500)),
        top_n: Math.min(15, chunks.length),
        return_documents: false
      })
    })
    const data = await res.json()
    if (!data.results) { console.log('Rerank failed:', data); return chunks.slice(0, 10) }
    const reranked = data.results.map((r: any) => ({ ...chunks[r.index], rerank_score: r.relevance_score }))
    // Drop low-confidence chunks — below 0.05 are typically irrelevant noise
    const filtered = reranked.filter((c: any) => c.rerank_score >= 0.05)
    const used = filtered.length >= 3 ? filtered : reranked.slice(0, 3)
    console.log(`Reranked: top=${used[0]?.rerank_score?.toFixed(3)}, bottom=${used[used.length-1]?.rerank_score?.toFixed(3)} (${used.length} kept / ${reranked.length} total)`)
    return used
  } catch (e: any) {
    console.error('Rerank error:', e.message)
    return chunks.slice(0, 10)
  }
}

// ─── GRAPH QUERIES ───────────────────────────────────────────────────────────
// Retrieves structured facts from kg_* tables.
// Returns a pre-formatted text block ready to inject into LLM context.

export type GraphIntent =
  | { type: 'project_partners';    projectCode: string }
  | { type: 'partner_projects';    partnerName: string }
  | { type: 'technology_projects'; techName: string }
  | { type: 'domain_projects';     domain: string }
  | { type: 'programme_breakdown' }
  | { type: 'country_network' }
  | { type: 'iris_technologies' }
  | { type: 'active_projects' }
  | { type: 'coordinator_projects' }
  | { type: 'none' }

export function detectGraphIntent(query: string): GraphIntent {
  const q = query.toLowerCase()

  // "partners in/of PROJECT" — must come before broad patterns
  const partnerIn = q.match(/\bpartners?\b.{0,20}\b([A-Z][A-Z0-9\-]{2,})\b/i)
    || query.match(/\b([A-Z][A-Z0-9\-]{2,})\b.{0,20}\bpartners?\b/)
  if (partnerIn) {
    const code = (partnerIn[1] || partnerIn[1]).toUpperCase()
    const skip = new Set(['IRIS','NIR','HSI','PAT','TRL','EU','SME','API','ML','AI'])
    if (!skip.has(code)) return { type: 'project_partners', projectCode: code }
  }

  // "projects with/involving PARTNER NAME"
  if (/\b(projects?.{0,10}(with|involv|includ|from|by|at)\b|worked.{0,10}with\b)/i.test(q)) {
    const rest = q.replace(/.*?(projects?.{0,10}(with|involv|includ|from|by|at)|worked.{0,10}with)\s*/i, '').trim()
    if (rest.length > 3) return { type: 'partner_projects', partnerName: rest }
  }

  // "which projects use NIR/spectroscopy/hyperspectral"
  if (/\b(use|using|utilis|employ|appl).{0,20}(nir|spectroscop|hyperspectral|raman|ftir|chemometrics|machine learning|deep learning|imaging)\b/i.test(q)
      || /\b(nir|spectroscop|hyperspectral|raman|chemometrics).{0,15}projects?\b/i.test(q)) {
    const tech = (q.match(/\b(nir|near.infrared|raman|ftir|hyperspectral|chemometrics|machine learning|deep learning|pls|plsr|ann|cnn|process control|inline monitoring)\b/i) || [])[0] || ''
    if (tech) return { type: 'technology_projects', techName: tech }
  }

  // application domain queries
  if (/\b(food|pharma|agricultur|recycl|wast|environmental|industrial|dairy|meat|grain|beverage|medic|diagnos)\b/i.test(q)
      && /\bprojects?\b/i.test(q)) {
    const domain = (q.match(/\b(food quality|food safety|pharmaceutical|pharma|agriculture|recycling|waste sorting|environmental monitoring|dairy|meat|grain|beverage)\b/i) || [])[0] || ''
    if (domain) return { type: 'domain_projects', domain }
  }

  // programme breakdown
  if (/\b(how many|breakdown|count|number of).{0,20}(horizon|h2020|enterprise ireland|funded|programme)\b/i.test(q)
      || /\b(horizon|h2020|interreg|enterprise ireland).{0,20}(how many|count|list|breakdown)\b/i.test(q)) {
    return { type: 'programme_breakdown' }
  }

  // country / geography queries
  if (/\b(countr|geograph|locat|where|nation|european)\b/i.test(q)
      && /\b(partner|consortium|network|organisation)\b/i.test(q)) {
    return { type: 'country_network' }
  }

  // IRIS technology portfolio
  if (/\b(what|which|list|show).{0,20}(technolog|instruments?|tools?|platforms?|software).{0,20}(iris|develop|use|built|offer)\b/i.test(q)
      || /\biris.{0,20}(technolog|capabilit|portfolio|develops?|offer)\b/i.test(q)
      || /\bcanonical.{0,20}technolog\b/i.test(q)) {
    return { type: 'iris_technologies' }
  }

  // Active / current projects
  if (/\b(current|active|ongoing|running|live).{0,20}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(current|active|ongoing|running|now)\b/i.test(q)) {
    return { type: 'active_projects' }
  }

  // Projects IRIS coordinates
  if (/\b(coordinat|lead|leads|leading|led).{0,20}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(coordinat|iris.{0,10}lead|iris.{0,10}coord)\b/i.test(q)
      || /\biris.{0,20}(coordinat|project.{0,5}lead)\b/i.test(q)) {
    return { type: 'coordinator_projects' }
  }

  return { type: 'none' }
}

// Returns a clean display label for a project code, or null if the row should be skipped.
// Strips TERM- prefixes and hides DOMAIN_* pseudo-projects.
function formatProjectRef(code: string, fullName?: string): string | null {
  if (/^DOMAIN_/i.test(code)) return null
  const cleanCode = code.replace(/^TERM-/i, '')
  if (fullName && fullName !== cleanCode) return `${fullName} (${cleanCode})`
  return cleanCode
}

// Deduplicates an array of graph rows by project_code.
function dedupeByCode<T extends { project_code: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.project_code)) return false
    seen.add(r.project_code)
    return true
  })
}

export async function queryGraph(intent: GraphIntent): Promise<string> {
  if (intent.type === 'none') return ''

  try {
    if (intent.type === 'project_partners') {
      const { data, error } = await supabase.rpc('get_project_partners', { p_code: intent.projectCode })
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.partner_name} (${r.partner_type || 'partner'}, ${r.country_code || '?'}) — ${r.role || 'partner'}`
      ).join('\n')
      return `## Graph: Partners in ${intent.projectCode}\n${rows}`
    }

    if (intent.type === 'partner_projects') {
      const { data, error } = await supabase.rpc('get_partner_projects', { p_name: intent.partnerName })
      if (error || !data?.length) return ''
      const rows = dedupeByCode(data as any[])
        .map(r => {
          const label = formatProjectRef(r.project_code, r.full_name)
          if (!label) return null
          return `- ${label} — ${r.funding_programme || '?'} — ${r.role || 'partner'} [${r.status}]`
        })
        .filter(Boolean)
        .join('\n')
      if (!rows) return ''
      return `## Graph: Projects involving "${intent.partnerName}"\n${rows}`
    }

    if (intent.type === 'technology_projects') {
      const { data, error } = await supabase.rpc('get_projects_by_technology', { p_tech: intent.techName })
      if (error || !data?.length) return ''
      const rows = dedupeByCode(data as any[])
        .map(r => {
          const label = formatProjectRef(r.project_code, r.full_name)
          if (!label) return null
          return `- ${label} — ${r.technology_name} — ${r.funding_programme || '?'}`
        })
        .filter(Boolean)
        .join('\n')
      if (!rows) return ''
      return `## Graph: Projects using "${intent.techName}"\n${rows}`
    }

    if (intent.type === 'domain_projects') {
      const { data, error } = await supabase.rpc('get_projects_by_domain', { p_domain: intent.domain })
      if (error || !data?.length) return ''
      const rows = dedupeByCode(data as any[])
        .map(r => {
          const label = formatProjectRef(r.project_code, r.full_name)
          if (!label) return null
          return `- ${label} — ${r.domain} — ${r.funding_programme || '?'}`
        })
        .filter(Boolean)
        .join('\n')
      if (!rows) return ''
      return `## Graph: Projects in domain "${intent.domain}"\n${rows}`
    }

    if (intent.type === 'programme_breakdown') {
      const { data, error } = await supabase.rpc('get_programme_breakdown')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r => `- ${r.funding_programme}: ${r.project_count} projects`).join('\n')
      return `## Graph: Projects by funding programme\n${rows}`
    }

    if (intent.type === 'country_network') {
      const { data, error } = await supabase.rpc('get_country_network')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.country_code}: ${r.partner_count} partner(s) across ${r.project_count} project(s)`
      ).join('\n')
      return `## Graph: Partner country network\n${rows}`
    }

    if (intent.type === 'iris_technologies') {
      const { data, error } = await supabase.rpc('get_iris_technologies')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.technology_name} [${r.category}] — ${r.project_count} project(s): ${r.example_projects}`
      ).join('\n')
      return `## Graph: IRIS Technology Portfolio\n${rows}`
    }

    if (intent.type === 'active_projects') {
      const { data, error } = await supabase.rpc('get_active_projects')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r => {
        const label = formatProjectRef(r.project_code, r.full_name)
        if (!label) return null
        const trl = r.trl_start && r.trl_end ? ` TRL ${r.trl_start}→${r.trl_end}` : ''
        return `- ${label} — ${r.funding_programme || '?'}${trl} — ${r.iris_role || 'partner'}`
      }).filter(Boolean).join('\n')
      if (!rows) return ''
      return `## Graph: Active IRIS Projects\n${rows}`
    }

    if (intent.type === 'coordinator_projects') {
      const { data, error } = await supabase.rpc('get_coordinator_projects')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r => {
        const label = formatProjectRef(r.project_code, r.full_name)
        if (!label) return null
        const size = r.consortium_size ? ` — ${r.consortium_size} partners` : ''
        return `- ${label} — ${r.funding_programme || '?'}${size}`
      }).filter(Boolean).join('\n')
      if (!rows) return ''
      return `## Graph: Projects IRIS Coordinates\n${rows}`
    }

  } catch (e: any) {
    console.error('Graph query error:', e.message)
  }
  return ''
}

// ─── PROPOSAL CONTEXT QUERY ──────────────────────────────────────────────────
// Calls get_proposal_context() composite RPC — returns projects, partners,
// technologies, and WP stats for a given topic in one round-trip.
// Used by proposal route and concept generator.

export async function queryProposalContext(topic: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('get_proposal_context', { p_topic: topic })
    if (error || !data) { console.error('get_proposal_context error:', error?.message); return '' }

    const d = data as any
    const parts: string[] = []

    if (d.projects?.length) {
      const projectLines = (d.projects as any[])
        .map(p => {
          const label = formatProjectRef(p.project_code, p.full_name)
          if (!label) return null
          const roles = Array.isArray(p.iris_functional_roles) ? p.iris_functional_roles.join(', ') : (p.iris_role || 'partner')
          const trl = p.trl_start && p.trl_end ? ` TRL ${p.trl_start}→${p.trl_end}` : ''
          const size = p.consortium_size ? ` ${p.consortium_size} partners` : ''
          const dur = p.duration_months ? ` ${p.duration_months}mo` : ''
          return `- ${label}: ${roles}${trl}${size}${dur}`
        })
        .filter(Boolean)
      if (projectLines.length) parts.push(`## Relevant IRIS Projects\n${projectLines.join('\n')}`)
    }

    if (d.technologies?.length) {
      const techLines = (d.technologies as any[]).map(t => `- ${t.name} [${t.category}]`)
      parts.push(`## IRIS Technologies Used\n${techLines.join('\n')}`)
    }

    if (d.partners?.length) {
      const seen = new Set<string>()
      const partnerLines = (d.partners as any[])
        .filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true })
        .slice(0, 40)
        .map(p => `- ${p.name} (${p.country || '?'}, ${p.type || 'partner'}) — ${p.role || 'partner'}`)
      parts.push(`## Past Consortium Partners\n${partnerLines.join('\n')}`)
    }

    if (d.stats) {
      const s = d.stats
      const statsLine = [
        s.project_count   ? `${s.project_count} matching projects` : '',
        s.avg_consortium_size ? `avg consortium ${s.avg_consortium_size} partners` : '',
        s.avg_duration_months ? `avg duration ${s.avg_duration_months} months` : '',
        s.coordinator_count   ? `IRIS coordinator in ${s.coordinator_count}` : '',
        s.wp_leader_count     ? `WP leader in ${s.wp_leader_count}` : '',
      ].filter(Boolean).join(' | ')
      if (statsLine) parts.push(`## Project Stats\n${statsLine}`)
    }

    return parts.join('\n\n')
  } catch (e: any) {
    console.error('queryProposalContext error:', e.message)
    return ''
  }
}

// ─── FTS SUMMARY SEARCH ───────────────────────────────────────────────────────
// Calls search_project_summaries RPC — PostgreSQL full-text search over summaries.
// Returns ProjectSummaryGroup[] sorted by FTS rank, scoped to given dimensions.
// Use instead of fetchSummariesByDimension when you have a topic query.

export async function searchSummariesByTopic(
  queryText: string,
  dimensions?: string[],
  limit = 15
): Promise<ProjectSummaryGroup[]> {
  try {
    const params: any = { query_text: queryText, result_limit: limit * (dimensions?.length || 1) }
    if (dimensions?.length === 1) params.filter_dimension = dimensions[0]

    const { data, error } = await supabase.rpc('search_project_summaries', params)
    if (error || !data?.length) return []

    // Filter to requested dimensions if multiple specified
    const rows = dimensions && dimensions.length > 1
      ? (data as any[]).filter(r => dimensions.includes(r.dimension))
      : (data as any[])

    // Group into ProjectSummaryGroup format
    const grouped: Record<string, ProjectSummaryGroup & { _rank: number }> = {}
    for (const row of rows) {
      if (!grouped[row.project_code]) {
        grouped[row.project_code] = {
          project_code: row.project_code,
          project_name: row.project_name,
          entry_type:   row.entry_type || 'active',
          dimensions:   {},
          keywords:     {},
          _rank:        row.rank || 0,
        }
      }
      grouped[row.project_code].dimensions[row.dimension] = row.summary
      grouped[row.project_code].keywords[row.dimension]   = row.keywords || []
      // Keep highest rank seen across dimensions
      if ((row.rank || 0) > grouped[row.project_code]._rank) {
        grouped[row.project_code]._rank = row.rank
      }
    }

    return Object.values(grouped)
      .filter(p => Object.keys(p.dimensions).length > 0)
      .sort((a, b) => b._rank - a._rank)
      .slice(0, limit)
      .map(({ _rank, ...p }) => p)

  } catch (e: any) {
    console.error('searchSummariesByTopic error:', e.message)
    return []
  }
}

// ─── STRUCTURED FACTS QUERY ──────────────────────────────────────────────────
// Queries project_results table for extracted numerical/measured results.
// Falls back gracefully if the table is empty (extraction still running).

export async function queryStructuredFacts(
  queryText: string,
  projectCodes?: string[]
): Promise<string> {
  try {
    if (projectCodes && projectCodes.length > 0) {
      const { data, error } = await supabase.rpc('get_project_results', { p_codes: projectCodes })
      if (error) { console.error('get_project_results error:', error.message); return '' }
      if (!data?.length) return ''

      const grouped: Record<string, any[]> = {}
      for (const row of (data as any[])) {
        if (!grouped[row.project_code]) grouped[row.project_code] = []
        grouped[row.project_code].push(row)
      }
      return Object.entries(grouped).map(([code, rows]) => {
        const lines = (rows as any[]).map(r => {
          let s = `- ${r.parameter}: ${r.value}${r.unit ? ' ' + r.unit : ''}`
          if (r.method) s += ` [${r.method}]`
          if (r.application) s += ` — ${r.application}`
          if (r.notes) s += ` (${r.notes})`
          return s
        }).join('\n')
        return `## Measured Results: ${code}\n${lines}`
      }).join('\n\n')

    } else {
      const { data, error } = await supabase.rpc('search_project_results', { p_query: queryText })
      if (error) { console.error('search_project_results error:', error.message); return '' }
      if (!data?.length) return ''

      const lines = (data as any[]).map(r => {
        let s = `- ${r.project_code}: ${r.parameter}: ${r.value}${r.unit ? ' ' + r.unit : ''}`
        if (r.method) s += ` [${r.method}]`
        if (r.application) s += ` — ${r.application}`
        return s
      }).join('\n')
      return `## Structured Numerical Results\n${lines}`
    }
  } catch (e: any) {
    console.error('queryStructuredFacts error:', e.message)
    return ''
  }
}

// ─── SYNTHESIS QUERY ─────────────────────────────────────────────────────────
// For cross-project synthesis: fetches full result sets grouped by project
// for a focused set of dimensions, then formats for map-reduce LLM pass.

export async function fetchSynthesisContext(
  queryText: string,
  dimensions: string[]
): Promise<{ projectCode: string; projectName: string; summaryBlocks: string }[]> {
  try {
    const all = await fetchAllSummaries()
    const relevant = all.filter((r: any) => dimensions.includes(r.dimension))

    const stopWords = new Set(['with','that','this','from','have','been','were','they',
      'their','into','will','also','each','more','than','about','which','iris',
      'technology','solutions','project','projects'])
    const queryWords = queryText.toLowerCase().split(/\s+/)
      .filter((w: string) => w.length > 3 && !stopWords.has(w))

    const scores: Record<string, number> = {}
    for (const row of relevant) {
      const text = (row.summary + ' ' + (row.keywords || []).join(' ')).toLowerCase()
      const score = queryWords.filter((w: string) => text.includes(w)).length
      scores[row.project_code] = (scores[row.project_code] || 0) + score
    }

    const topCodes = new Set(
      Object.entries(scores)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 40)
        .map(([code]) => code)
    )

    const grouped: Record<string, { name: string; rows: any[] }> = {}
    for (const row of relevant) {
      if (!topCodes.has(row.project_code)) continue
      if (!grouped[row.project_code]) grouped[row.project_code] = { name: row.project_name, rows: [] }
      grouped[row.project_code].rows.push(row)
    }

    return Object.entries(grouped).map(([code, g]) => ({
      projectCode: code,
      projectName: g.name,
      summaryBlocks: g.rows.map((r: any) => `[${r.dimension}]: ${r.summary}`).join('\n')
    }))
  } catch (e: any) {
    console.error('fetchSynthesisContext error:', e.message)
    return []
  }
}

// ─── SUMMARY CACHE ───────────────────────────────────────────────────────────

const SUMMARY_TTL_MS = 5 * 60 * 1000

let _summaryCache: any[] | null = null
let _summaryCacheAt = 0

async function fetchAllSummaries(): Promise<any[]> {
  const now = Date.now()
  if (_summaryCache && now - _summaryCacheAt < SUMMARY_TTL_MS) {
    console.log(`Summaries: cache hit (${_summaryCache.length} rows, age ${Math.round((now - _summaryCacheAt)/1000)}s)`)
    return _summaryCache
  }
  const { data, error } = await supabase
    .from('project_summaries')
    .select('project_code, project_name, folder, dimension, summary, keywords, entry_type')
    .order('project_code')
    .limit(5000)
  if (error || !data) throw new Error(error?.message || 'No summary data')
  _summaryCache = data
  _summaryCacheAt = now
  console.log(`Summaries: cache refreshed (${data.length} rows)`)
  return data
}

export function invalidateSummaryCache() {
  _summaryCache = null
  _summaryCacheAt = 0
}

// ─── STRUCTURED DIMENSION FETCH ───────────────────────────────────────────────
// Used by generate route. Returns all projects that have at least one of the
// requested dimensions, each with all their available dimension summaries.
// entryType: 'active' | 'terminated' | null (both)

export interface ProjectSummaryGroup {
  project_code: string
  project_name: string
  entry_type: string
  dimensions: Record<string, string>   // dimension → summary text
  keywords: Record<string, string[]>   // dimension → keywords array
}

export async function fetchSummariesByDimension(
  dimensions: string[],
  entryType?: 'active' | 'terminated' | null
): Promise<ProjectSummaryGroup[]> {
  const all = await fetchAllSummaries()

  const filtered = all.filter((r: any) => {
    if (!dimensions.includes(r.dimension)) return false
    if (entryType === 'active' && r.entry_type !== 'active') return false
    if (entryType === 'terminated' && r.entry_type !== 'terminated') return false
    return true
  })

  const grouped: Record<string, ProjectSummaryGroup> = {}
  for (const row of filtered) {
    if (!grouped[row.project_code]) {
      grouped[row.project_code] = {
        project_code: row.project_code,
        project_name: row.project_name,
        entry_type: row.entry_type,
        dimensions: {},
        keywords: {}
      }
    }
    grouped[row.project_code].dimensions[row.dimension] = row.summary
    grouped[row.project_code].keywords[row.dimension] = row.keywords || []
  }

  const projects = Object.values(grouped).filter(p => Object.keys(p.dimensions).length > 0)

  // Deduplicate by project_name: when both active and terminated entries exist
  // for the same project name (e.g. ECOBULK PBMO041 vs ECOBULK 730456),
  // keep the active entry and discard the terminated one.
  const byName: Record<string, ProjectSummaryGroup[]> = {}
  for (const p of projects) {
    const name = p.project_name.toLowerCase().trim()
    if (!byName[name]) byName[name] = []
    byName[name].push(p)
  }

  return Object.values(byName).map(group => {
    if (group.length === 1) return group[0]
    const active = group.find(p => p.entry_type === 'active')
    return active || group[0]
  })
}

// ─── CHAT SUMMARY QUERY ───────────────────────────────────────────────────────
// Used by chat route only — keyword-scored text blob for conversational Q&A.
// The generate route uses fetchSummariesByDimension instead.

function inferDimensions(queryText: string): string[] | null {
  const q = queryText.toLowerCase()
  const dims: string[] = []

  if (/technolog|instrument|spectroscop|sensor|imaging|spectromet|nir|libs|raman|ftir|hsi|visum|laser/i.test(q)) {
    dims.push('iris_technology', 'technology')
  }
  if (/sector|application|industr|use.?case|market|field|domain/i.test(q))
    dims.push('applications')
  if (/result|outcome|achiev|kpi|accuracy|performance|trl|metric|saving|reduction|yield/i.test(q)) {
    dims.push('iris_results', 'results')
  }
  if (/role|coordinator|partner|work.?package|wp|task|responsi|led by|lead/i.test(q))
    dims.push('iris_role')
  if (/validat|sample|precision|recall|f1|rmse|blind.?test|cross.?valid|field.?trial/i.test(q)) {
    dims.push('iris_validation', 'validation')
  }
  if (/partner|consortium|universit|institut|member|participant|country/i.test(q))
    dims.push('partners')
  if (/budget|grant|fund|cost|duration|start|end|date|coordinator|number/i.test(q))
    dims.push('metadata')
  if (/table.*technolog|technolog.*table/i.test(q)) {
    for (const d of ['iris_technology','technology','iris_results','results','iris_validation','validation'])
      if (!dims.includes(d)) dims.push(d)
  }

  return dims.length > 0 ? dims : null
}

export async function querySummaries(queryText: string): Promise<string> {
  try {
    const data = await fetchAllSummaries()

    const relevantDims = inferDimensions(queryText)
    console.log(`Summaries: query dimensions → ${relevantDims ? relevantDims.join(', ') : 'all'}`)

    const dimFiltered = relevantDims
      ? data.filter((r: any) => relevantDims.includes(r.dimension))
      : data

    const stopWords = new Set(['with','that','this','from','have','been','were','they',
      'their','into','will','also','each','more','than','about','which','iris',
      'technology','solutions','project','projects','technologies'])
    const queryWords = queryText.toLowerCase()
      .split(/\s+/)
      .filter((w: string) => w.length > 3 && !stopWords.has(w))

    const projectScores: Record<string, number> = {}
    for (const row of dimFiltered) {
      const text = (row.summary + ' ' + (row.keywords || []).join(' ')).toLowerCase()
      const score = queryWords.filter((w: string) => text.includes(w)).length
      projectScores[row.project_code] = (projectScores[row.project_code] || 0) + score
    }

    const MAX_PROJECTS = 60
    const sortedCodes = Object.entries(projectScores)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([code]) => code)

    const topCodes = new Set(
      sortedCodes.length > 0
        ? sortedCodes.slice(0, MAX_PROJECTS)
        : dimFiltered.map((r: any) => r.project_code).slice(0, MAX_PROJECTS)
    )

    const source = dimFiltered.filter((r: any) => topCodes.has(r.project_code))
    console.log(`Summaries: ${source.length} rows across ${topCodes.size} projects (from ${data.length} total)`)

    const grouped: Record<string, any[]> = {}
    for (const row of source) {
      if (!grouped[row.project_code]) grouped[row.project_code] = []
      grouped[row.project_code].push(row)
    }

    // Suppress legacy dimension when iris_* equivalent exists for the same project
    const SUPERSEDED_BY: Record<string, string> = {
      'technology': 'iris_technology',
      'results':    'iris_results',
      'validation': 'iris_validation',
    }

    return Object.entries(grouped).map(([code, rows]: [string, any[]]) => {
      const name = rows[0].project_name
      const presentDims = new Set(rows.map((r: any) => r.dimension))
      const dedupedRows = rows.filter((r: any) => {
        const supersededBy = SUPERSEDED_BY[r.dimension]
        return !(supersededBy && presentDims.has(supersededBy))
      })
      const dims = dedupedRows.map((r: any) => `  [${r.dimension}]: ${r.summary}`).join('\n')
      return `### ${rows[0].entry_type === 'domain' ? 'Domain' : 'Project'}: ${name} (${code})\n${dims}`
    }).join('\n\n')

  } catch (e: any) {
    console.error('Summary error:', e.message)
    return ''
  }
}
