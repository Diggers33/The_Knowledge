/**
 * IRIS KB — Shared utilities
 * Used by both /api/chat/route.ts and /api/generate/route.ts
 * Place at: lib/iris-kb.ts
 */

import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL    ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY   ?? 'placeholder-key'
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
  // Match tokens that are fully uppercase (NANOBLOC, BIORADAR) or contain a digit (SORT4CIRC)
  // Filter on ORIGINAL case before uppercasing — avoids "pharma", "compare" etc. being treated as codes
  const candidates = text.match(/\b[A-Za-z][A-Z0-9a-z]{2,}(?:-[A-Za-z0-9]+)*\b/g) || []
  return [...new Set(
    candidates
      .filter(c => /[0-9]/.test(c) || c === c.toUpperCase())  // check original case first
      .map(c => c.toUpperCase())
      .filter(c => !TAG_STOPWORDS.has(c))
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
  | { type: 'domain_list' }
  | { type: 'role_list' }
  | { type: 'project_list';      status?: string }
  | { type: 'trl_breakdown' }
  | { type: 'status_breakdown' }
  | { type: 'budget_summary' }
  | { type: 'sector_stats';      sector: string }
  | { type: 'partners_by_country'; countryCode: string; countryName: string }
  | { type: 'frequent_partners' }
  | { type: 'none' }

export function detectGraphIntent(query: string): GraphIntent {
  const q = query.toLowerCase()

  // ── Funding programme queries that mention country names — handle before country map ──
  if (/\benterprise\s+ireland\b/i.test(q)
      && /\b(how many|count|number|funded|projects?|breakdown)\b/i.test(q)) {
    return { type: 'programme_breakdown' }
  }

  // ── Partners by country — FIRST to prevent project_partners firing on country adjectives ──
  const COUNTRY_MAP: Record<string, string> = {
    'italian': 'IT', 'italy': 'IT',
    'german': 'DE', 'germany': 'DE',
    'french': 'FR', 'france': 'FR',
    'spanish': 'ES', 'spain': 'ES',
    'dutch': 'NL', 'netherlands': 'NL', 'holland': 'NL',
    'belgian': 'BE', 'belgium': 'BE',
    'irish': 'IE', 'ireland': 'IE',
    'greek': 'GR', 'greece': 'GR',
    'portuguese': 'PT', 'portugal': 'PT',
    'swedish': 'SE', 'sweden': 'SE',
    'danish': 'DK', 'denmark': 'DK',
    'finnish': 'FI', 'finland': 'FI',
    'austrian': 'AT', 'austria': 'AT',
    'polish': 'PL', 'poland': 'PL',
    'czech': 'CZ', 'czechia': 'CZ',
    'romanian': 'RO', 'romania': 'RO',
    'hungarian': 'HU', 'hungary': 'HU',
    'british': 'GB', 'uk': 'GB', 'united kingdom': 'GB',
    'norwegian': 'NO', 'norway': 'NO',
    'swiss': 'CH', 'switzerland': 'CH',
    'turkish': 'TR', 'turkey': 'TR',
    'israeli': 'IL', 'israel': 'IL',
  }
  for (const [name, code] of Object.entries(COUNTRY_MAP)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(q)) {
      if (/\b(partners?|consortium|organisations?|organizations?|universit\w*|institu\w*|compan\w*|projects?|members?|participants?)\b/i.test(q)
       || /\b(from|based.{0,5}in|located.{0,5}in)\b/i.test(q)) {
        return { type: 'partners_by_country', countryCode: code, countryName: name }
      }
    }
  }

  // ── Specific project lookup: "partners in PROJECT" / "organisations in PROPAT" ──
  // Use query (original case) for both — no i flag so only uppercase codes match
  const partnerIn = query.match(/\bpartners?\b.{0,20}\b([A-Z][A-Z0-9\-]{2,})\b/)
    || query.match(/\b([A-Z][A-Z0-9\-]{2,})\b.{0,20}\b(partners?|participants?|organisations?|consortium)\b/)
    || query.match(/\b(?:organisations?|consortium|participants?)\b.{0,35}\b([A-Z][A-Z0-9\-]{3,})\b/)
  if (partnerIn) {
    const code = (partnerIn[1]).toUpperCase()
    const skip = new Set(['IRIS','NIR','HSI','PAT','TRL','EU','SME','API','ML','AI',
      'ITALIAN','GERMAN','FRENCH','SPANISH','DUTCH','IRISH','GREEK','PORTUGUESE','SWEDISH',
      'DANISH','FINNISH','AUSTRIAN','POLISH','CZECH','BRITISH'])
    if (!skip.has(code) && code.length >= 4) return { type: 'project_partners', projectCode: code }
  }

  // ── TRL breakdown (before project_list to avoid "how many" collision) ────────
  if (/\b(trl|technology.?readiness).{0,25}(breakdown|distribution|level|range|journey|profile)\b/i.test(q)
      || /\b(breakdown|distribution|range|profile).{0,25}(trl|technology.?readiness)\b/i.test(q)
      || /\bwhat.{0,15}trl\b/i.test(q)
      || /\btrl.{0,10}(start|end|from|to)\b/i.test(q)) {
    return { type: 'trl_breakdown' }
  }

  // ── "Budget breakdown by funding programme" — specific pattern before programme_breakdown ──
  if (/\bbudget.{0,20}breakdown\b/i.test(q)) {
    return { type: 'budget_summary' }
  }

  // ── Sector-scoped stats (before budget_summary to win on "food funding" queries) ──
  {
    const sectorMatch = q.match(/\b(agri[-\s]?food|agro[-\s]?food|food|pharma(?:ceutical)?|agricultur\w*|recycl\w*|automotive|aerospace|plastics?|textile|wood|steel|water|energy|construction|packaging)\b/i)
    if (sectorMatch && (
      /\b(how many|number of|count)\b.{0,60}\b(projects?\w*|participat\w*)\b/i.test(q)
      || /\b(total|overall|eu).{0,20}(fund\w*|budget|grant).{0,60}(sector|industry|area|field|projects?\w*)\b/i.test(q)
      || /\b(fund\w*|budget|grant).{0,30}(sector|industry|area|field)\b/i.test(q)
      || /\b(sector|industry|domain|area).{0,30}(fund\w*|budget|projects?\w*|count|number|how many)\b/i.test(q)
      || /\btotal.{0,20}(fund\w*|budget).{0,30}(agri[-\s]?food|agro[-\s]?food|food|pharma\w*|agricultur\w*)\b/i.test(q)
    )) {
      return { type: 'sector_stats', sector: sectorMatch[1].toLowerCase() }
    }
  }

  // ── Programme breakdown (before budget_summary) ───────────────────────────────
  if (/\b(how many|breakdown|count|number of).{0,20}(horizon|h2020|enterprise ireland|funded|programme)\b/i.test(q)
      || /\b(horizon|h2020|interreg|enterprise ireland).{0,20}(how many|count|list|breakdown)\b/i.test(q)
      || /\bfunding.{0,15}programme.{0,15}(breakdown|distribution|split)\b/i.test(q)
      || /\bbreakdown.{0,20}(by|of).{0,10}(fund\w*|programme|program)\b/i.test(q)
      || /\bprojects?.{0,20}by.{0,10}(fund\w*|programme|program)\b/i.test(q)) {
    return { type: 'programme_breakdown' }
  }

  // ── Budget / funding summary ──────────────────────────────────────────────────
  if (/\b(total.{0,10}(budget|funding|grant)|budget.{0,20}(total|summary|portfolio))\b/i.test(q)
      || /\b(how much|overall).{0,15}(fund\w*|budget|grant|money)\b/i.test(q)
      || /\b(budget|grant|funding).{0,20}(iris|projects?|portfolio|programme)\b/i.test(q)
      || /\b(iris|project).{0,15}(budget|fund\w*).{0,15}(total|all|overall|breakdown)\b/i.test(q)) {
    return { type: 'budget_summary' }
  }

  // ── Status breakdown (before active_projects) ────────────────────────────────
  if (/\b(active.{0,10}(vs|and|versus|or).{0,10}terminat\w*|terminat\w*.{0,10}(vs|and|versus|or).{0,10}active)\b/i.test(q)
      || /\bproject.{0,10}status.{0,10}(breakdown|distribution|split|overview)\b/i.test(q)
      || /\bhow many.{0,20}(active|terminat\w*|complet\w*|ongoing|finish\w*).{0,20}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(been complet\w*|been terminat\w*|been finish\w*|have complet\w*|have terminat\w*)\b/i.test(q)) {
    return { type: 'status_breakdown' }
  }

  // ── IRIS role list: non-technical, management, coordination roles ─────────────
  if (/\b(non.?technical|management|managerial|coordination|dissemination|exploitation|communication).{0,20}roles?\b/i.test(q)
      || /\b(what|which|list|show|describe).{0,30}roles?.{0,20}(iris|played|had|taken|held)\b/i.test(q)
      || /\biris.{0,25}(roles?|responsibilit\w*|function|position|involvement)\b/i.test(q)
      || /\b(roles?|responsibilit\w*|function).{0,20}(iris|played|undertaken|carried)\b/i.test(q)
      || /\bhow (has|have|did).{0,15}iris.{0,20}(contribut\w*|involv\w*|participat\w*|been involved)\b/i.test(q)
      || /\bwhat.{0,20}(role|position|responsib\w*).{0,20}iris.{0,20}(in|across|within)\b/i.test(q)
      || /\biris.{0,15}(led|lead|leading).{0,20}(work.?package|wp|task)\b/i.test(q)
      || /\b(has iris|did iris).{0,15}led?\b/i.test(q)
      || /\bin which projects.{0,20}iris.{0,20}(the |is )coordinat\w*/i.test(q)) {
    return { type: 'role_list' }
  }

  // ── Domain/sector list: all sectors IRIS has worked in ───────────────────────
  // Must come BEFORE domain_projects (which needs a specific domain name)
  if (/\b(what|which|list|show|tell|describe).{0,40}(sector|application|industr\w*|domain|field|market|area|use.?case).{0,30}(iris|worked|applied|covered|addressed|active)\b/i.test(q)
      || /\biris.{0,35}(sector|application|industr\w*|domain|field|market|area).{0,25}(worked|active|cover\w*|address\w*|involv\w*)\b/i.test(q)
      || /\b(sector|application|industr\w*|domain|field|area).{0,20}(iris.{0,10})?(has|have|had).{0,20}worked\b/i.test(q)
      || /\b(all|full|complete|comprehensive).{0,15}(sector|application|domain|industr\w*|field)\b/i.test(q)
      || /\bwhat.{0,20}(sector|application|industr\w*|domain|field|market|area).{0,20}(iris|these projects?)\b/i.test(q)) {
    return { type: 'domain_list' }
  }

  // ── Country / geography queries ───────────────────────────────────────────────
  if ((/\b(countr\w*|geograph\w*|locat\w*|nation\w*|european)\b/i.test(q)
      && /\b(partners?|consortium|network|organisations?|distribution)\b/i.test(q))
      || /\b(which|what|list).{0,20}countr\w*.{0,20}(partners?|consortium|organisations?|represented)\b/i.test(q)
      || /\b(partners?|organisations?).{0,20}(each|per|by|from.{0,5}each).{0,10}countr\w*\b/i.test(q)
      || /\b(geographic\w*|geograph\w*).{0,20}(distribution|spread|breakdown|network)\b/i.test(q)) {
    return { type: 'country_network' }
  }

  // ── IRIS technology portfolio (broad, no specific tech named) ────────────────
  if (/\b(what|which|list|show|table|create.{0,10}table).{0,40}(technolog\w*|instruments?|tools?|platforms?|software|capabilit\w*).{0,40}(iris|develop\w*|use|built|offer\w*|created)\b/i.test(q)
      || /\b(technolog\w*|instruments?|capabilit\w*|portfolio).{0,30}(iris|develop\w*|built|created|offer\w*)\b/i.test(q)
      || /\biris.{0,25}(technolog\w*|capabilit\w*|portfolio|develops?|offer\w*|instruments?)\b/i.test(q)
      || /\bcanonical.{0,20}technolog\w*\b/i.test(q)
      || /\btechnolog\w*.{0,20}(develop\w*|creat\w*|built).{0,20}by.{0,10}iris\b/i.test(q)
      || /\biris.{0,10}(technolog\w*|capabilit\w*|instruments?).{0,10}(list|portfolio|overview)\b/i.test(q)) {
    return { type: 'iris_technologies' }
  }

  // ── Specific technology usage: "which projects use NIR" ──────────────────────
  if (/\b(use|using|utilis\w*|employ\w*|appl\w*|involv\w*).{0,20}(nir|spectroscop\w*|hyperspectral|raman|ftir|chemometrics|machine learning|deep learning|imaging)\b/i.test(q)
      || /\b(nir|spectroscop\w*|hyperspectral|raman|chemometrics).{0,15}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(nir|raman|ftir|hyperspectral|chemometrics)\b/i.test(q)) {
    const tech = (q.match(/\b(nir|near.infrared|raman|ftir|hyperspectral|chemometrics|machine learning|deep learning|pls|plsr|ann|cnn|process control|inline monitoring)\b/i) || [])[0] || ''
    if (tech) return { type: 'technology_projects', techName: tech }
  }

  // ── Specific domain: "projects in food/pharma/agriculture" ───────────────────
  if (/\b(food|pharma\w*|agricultur\w*|recycl\w*|wast\w*|environmental|industrial|dairy|meat|grain|beverage|medic\w*|diagnos\w*|aviation|textile|plastic\w*|wood|steel|water|packaging)\b/i.test(q)
      && /\b(projects?|work|sector|industry|area|field)\b/i.test(q)) {
    const domain = (q.match(/\b(food quality|food safety|food\b|pharmaceutical|pharma\b|agriculture|agricultur\w*|recycling|waste sorting|environmental monitoring|dairy|meat|grain|beverage|aviation|textile|plastics?|wood|steel|water treatment|packaging)\b/i) || [])[0] || ''
    if (domain) return { type: 'domain_projects', domain }
  }

  // ── Most frequent / recurring consortium partners ─────────────────────────────
  if (/\b(most.{0,10}(frequent|common|recurring|regular).{0,20}(partner|consortium|collaborat|organisation)\b)/i.test(q)
      || /\b(partner|consortium|collaborat|organisation).{0,20}(most.{0,10}(frequent|common|recurring)|how.{0,5}many.{0,5}time|repeat|across.{0,10}project)\b/i.test(q)
      || /\b(which|what|list|show).{0,20}(partner|consortium|collaborat|organisation).{0,30}(iris.{0,20})?(most|frequent|common|recurring|often|regular|across|repeat)\b/i.test(q)
      || /\bcollaborated.{0,20}most.{0,10}(frequent|often)\b/i.test(q)
      || /\bmost.{0,10}(partner|collaborat).{0,20}iris\b/i.test(q)) {
    return { type: 'frequent_partners' }
  }

  // ── Projects with a specific partner ─────────────────────────────────────────
  if (/\b(projects?.{0,10}(with|involv\w*|includ\w*|from|by|at)\b|worked.{0,10}with\b|has iris.{0,10}worked.{0,5}with\b)/i.test(q)) {
    const rest = q.replace(/.*?(projects?.{0,10}(with|involv\w*|includ\w*|from|by|at)|worked.{0,10}with|has iris.{0,10}worked.{0,5}with)\s*/i, '').trim()
    if (rest.length > 3) return { type: 'partner_projects', partnerName: rest }
  }

  // ── Active / current projects (before project_list to avoid "list all ongoing" misroute) ──
  if (/\b(current|active|ongoing|running|live).{0,20}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(current|active|ongoing|running|now|currently)\b/i.test(q)
      || /\blist.{0,10}(all.{0,5})?ongoing\b/i.test(q)) {
    return { type: 'active_projects' }
  }

  // ── Project list (general enumeration) ───────────────────────────────────────
  if (/\b(list|show|give me|what are).{0,15}all.{0,15}(iris.{0,10})?projects?\b/i.test(q)
      || /\ball.{0,10}(iris.{0,10})?projects?\b/i.test(q)
      || /\b(full|complete|comprehensive).{0,15}(list|set).{0,10}(of.{0,10})?projects?\b/i.test(q)
      || /\bhow many projects.{0,20}(total|overall|altogether|in total|has iris|does iris)\b/i.test(q)) {
    return { type: 'project_list' }
  }

  // ── Projects IRIS coordinates ─────────────────────────────────────────────────
  if (/\b(coordinat\w*|leads?|leading|led).{0,20}projects?\b/i.test(q)
      || /\bprojects?.{0,20}(coordinat\w*|iris.{0,10}lead|iris.{0,10}coord|project.coordinator)\b/i.test(q)
      || /\biris.{0,20}(coordinat\w*|project.{0,5}lead)\b/i.test(q)
      || /\bwhich projects.{0,20}(does iris|iris.{0,5}is).{0,20}coordinat\w*/i.test(q)
      || /\bprojects.{0,15}where.{0,15}iris.{0,15}(is|as).{0,15}coordinat\w*/i.test(q)
      || /\biris.{0,20}(the |is ).{0,5}coordinat\w*/i.test(q)) {
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
      let { data, error } = await supabase.rpc('get_project_partners', { p_code: intent.projectCode })
      // Fallback: project may be stored under TERM- prefix in kg_projects
      if (!error && (!data?.length)) {
        const fallback = await supabase.rpc('get_project_partners', { p_code: `TERM-${intent.projectCode}` })
        if (!fallback.error && fallback.data?.length) { data = fallback.data }
      }
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

    if (intent.type === 'domain_list') {
      const { data, error } = await supabase.rpc('get_domain_list')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.domain}: ${r.project_count} project(s) — ${r.project_codes}`
      ).join('\n')
      return `## Graph: Sectors & Application Domains\n${rows}`
    }

    if (intent.type === 'role_list') {
      const { data, error } = await supabase.rpc('get_iris_role_list')
      if (error || !data?.length) return ''
      // Group by primary iris_role
      const grouped: Record<string, string[]> = {}
      for (const r of data as any[]) {
        const label = formatProjectRef(r.project_code, r.full_name)
        if (!label) continue
        const roles = [r.iris_role, ...(r.iris_functional_roles || [])].filter(Boolean)
        const roleKey = r.iris_role || 'other'
        if (!grouped[roleKey]) grouped[roleKey] = []
        const extra = roles.length > 1 ? ` [${roles.slice(1).join(', ')}]` : ''
        grouped[roleKey].push(`  - ${label} (${r.funding_programme || '?'})${extra}`)
      }
      const sections = Object.entries(grouped).map(([role, lines]) =>
        `**${role}** (${lines.length} projects)\n${lines.join('\n')}`
      ).join('\n\n')
      return `## Graph: IRIS Roles Across Projects\n${sections}`
    }

    if (intent.type === 'project_list') {
      const { data, error } = await supabase.rpc('get_project_list', { p_status: intent.status ?? null })
      if (error || !data?.length) return ''
      // Group by status
      const grouped: Record<string, string[]> = {}
      for (const r of data as any[]) {
        const label = formatProjectRef(r.project_code, r.full_name)
        if (!label) continue
        const trl = r.trl_start && r.trl_end ? ` TRL ${r.trl_start}→${r.trl_end}` : ''
        const s = r.status || 'unknown'
        if (!grouped[s]) grouped[s] = []
        grouped[s].push(`- ${label} — ${r.funding_programme || '?'}${trl} — ${r.iris_role || 'partner'}`)
      }
      const total = (data as any[]).length
      const sections = Object.entries(grouped).map(([status, lines]) =>
        `**${status}** (${lines.length})\n${lines.join('\n')}`
      ).join('\n\n')
      return `## Graph: All IRIS Projects (${total} total)\n${sections}`
    }

    if (intent.type === 'trl_breakdown') {
      const { data, error } = await supabase.rpc('get_trl_breakdown')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- TRL ${r.trl_start}→${r.trl_end}: ${r.project_count} project(s) — ${r.projects}`
      ).join('\n')
      return `## Graph: TRL Distribution Across Projects\n${rows}`
    }

    if (intent.type === 'status_breakdown') {
      const { data, error } = await supabase.rpc('get_status_breakdown')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.status}: ${r.project_count} project(s) — ${r.projects}`
      ).join('\n')
      return `## Graph: Project Status Breakdown\n${rows}`
    }

    if (intent.type === 'sector_stats') {
      const { data, error } = await supabase.rpc('get_sector_stats', { p_sector: intent.sector })
      if (error || !data?.length) return ''
      const r = (data as any[])[0]
      if (!r.project_count) return ''
      const budget = r.total_budget_eur
        ? `Total budget: €${(r.total_budget_eur / 1e6).toFixed(1)}M across ${r.projects_with_budget} projects with budget data.`
        : 'Budget data not fully available for all projects.'
      return `## Graph: Sector Stats — "${intent.sector}"\n` +
        `- Projects: ${r.project_count}\n` +
        `- ${budget}\n` +
        `- Matched domains: ${r.matched_domains}\n` +
        `- Projects: ${r.project_codes}`
    }

    if (intent.type === 'partners_by_country') {
      const { data, error } = await supabase.rpc('get_projects_by_country', { p_country_code: intent.countryCode })
      if (error || !data?.length) return ''
      // Group by project
      const byProject: Record<string, { name: string; programme: string; partners: string[] }> = {}
      for (const r of data as any[]) {
        const label = formatProjectRef(r.project_code, r.full_name)
        if (!label) continue
        if (!byProject[r.project_code]) byProject[r.project_code] = { name: label, programme: r.funding_programme || '?', partners: [] }
        const role = r.role ? ` (${r.role})` : ''
        const type = r.partner_type ? ` [${r.partner_type}]` : ''
        byProject[r.project_code].partners.push(`${r.partner_name}${type}${role}`)
      }
      const totalProjects = Object.keys(byProject).length
      const totalPartners = (data as any[]).length
      const rows = Object.values(byProject).map(p =>
        `**${p.name}** (${p.programme})\n${p.partners.map(pt => `  - ${pt}`).join('\n')}`
      ).join('\n\n')
      const countryLabel = intent.countryName.charAt(0).toUpperCase() + intent.countryName.slice(1)
      return `## Graph: ${countryLabel} Partners — ${totalPartners} partners across ${totalProjects} projects\n\n${rows}`
    }

    if (intent.type === 'frequent_partners') {
      const { data, error } = await supabase.rpc('get_frequent_partners', { p_limit: 30 })
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r =>
        `- ${r.partner_name} (${r.partner_type || 'partner'}, ${r.country_code || '?'}) — ${r.project_count} projects: ${r.project_codes}`
      ).join('\n')
      return `## Graph: Most Frequent IRIS Consortium Partners (top 30)\n${rows}`
    }

    if (intent.type === 'budget_summary') {
      const { data, error } = await supabase.rpc('get_budget_summary')
      if (error || !data?.length) return ''
      const rows = (data as any[]).map(r => {
        const total = r.total_budget_eur ? `€${(r.total_budget_eur/1e6).toFixed(1)}M total` : ''
        const avg = r.avg_budget_eur ? `, avg €${(r.avg_budget_eur/1e6).toFixed(1)}M` : ''
        return `- ${r.funding_programme || 'Unknown'}: ${r.project_count} projects${total ? ' — ' + total : ''}${avg}`
      }).join('\n')
      return `## Graph: Budget Summary by Programme\n${rows}`
    }

  } catch (e: any) {
    console.error('Graph query error:', e.message)
  }
  return ''
}

// ─── TECHNOLOGY TABLE DATA ────────────────────────────────────────────────────
// Returns one row per project with all IRIS-developed tech names + summaries.
// Used by the chat table-generation pipeline.

export interface ProjectTechRow {
  project_code:    string
  full_name:       string
  technologies:    string   // semicolon-separated
  tech_categories: string
  tech_summary:    string | null
  results_summary: string | null
}

export async function buildTechTableData(): Promise<ProjectTechRow[]> {
  const { data, error } = await supabase.rpc('get_project_technology_summary')
  if (error) { console.error('get_project_technology_summary error:', error.message); return [] }
  return (data || []) as ProjectTechRow[]
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
