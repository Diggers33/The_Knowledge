/**
 * IRIS KB — Generate Route (DOCX / PPTX)
 * Place at: app/api/generate/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import PptxGenJS from 'pptxgenjs'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat, AlignmentType, FootnoteReferenceRun } from 'docx'
import { embed, embedBatch, rerankChunks, querySummaries, fetchSummariesByDimension, searchChunks, detectProjectTags, supabase } from '@/lib/iris-kb'
import type { ProjectSummaryGroup } from '@/lib/iris-kb'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK  = '0A2E36'
const IRIS_CYAN  = '00C4D4'
const IRIS_WHITE = 'FFFFFF'

// ─── CHUNK RETRIEVAL — see lib/iris-kb.ts searchChunks()

async function generateSubQueries(prompt: string): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Generate 3-6 specific search queries to find relevant chunks in a photonics/spectroscopy project knowledge base. Return JSON array of strings only.' },
      { role: 'user', content: `Document request: "${prompt}"\n\nReturn JSON array of search queries:` }
    ],
    temperature: 0,
    max_tokens: 300
  })
  try {
    let raw = res.choices[0].message.content || '[]'
    if (raw.includes('```')) { raw = raw.split('```')[1]; if (raw.startsWith('json')) raw = raw.slice(4) }
    return JSON.parse(raw.trim())
  } catch { return [prompt] }
}

// ─── HyDE ─────────────────────────────────────────────────────────────────────

async function generateHypotheticalPassages(queries: string[]): Promise<string[]> {
  const results = await Promise.all(queries.map(async (q) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a technical writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company in Barcelona.
Write a short dense technical passage (3-5 sentences) that would appear in an IRIS project deliverable and DIRECTLY answers the query.
Use specifics: technology names, metric values, wavelength ranges, sample sizes.
Write as if this IS found in a document — not "IRIS may have..." but "IRIS developed... achieving...".
Output only the passage, no preamble.`
        },
        { role: 'user', content: q }
      ],
      temperature: 0.3,
      max_tokens: 120
    })
    return res.choices[0].message.content?.trim() || q
  }))
  console.log(`HyDE: generated ${results.length} hypothetical passages`)
  return results
}

async function retrieveChunks(prompt: string): Promise<any[]> {
  const projectTags = detectProjectTags(prompt)
  console.log('Project tags detected:', projectTags)

  const queries = await generateSubQueries(prompt)
  console.log('Sub-queries:', queries)

  const allQueries = [prompt.slice(0, 500), ...queries]
  const hypotheticals = await generateHypotheticalPassages(allQueries)
  const embeddings = await embedBatch(hypotheticals)
  console.log(`HyDE: batch embedded ${hypotheticals.length} passages in 1 API call`)

  const [primaryEmb, ...subEmbs] = embeddings
  const tags = projectTags.length > 0 ? projectTags : undefined

  // SQL-level project filtering via search_rag_filtered — no JS post-filter needed
  const [primaryResults, ...subResults] = await Promise.all([
    searchChunks(primaryEmb, prompt.slice(0, 500), 20, tags),
    ...queries.map((q: string, i: number) => searchChunks(subEmbs[i], q, 10, tags))
  ])

  const seen = new Set<number>()
  const merged: any[] = []
  for (const batch of [primaryResults, ...subResults]) {
    for (const chunk of batch) {
      if (!seen.has(chunk.id)) { seen.add(chunk.id); merged.push(chunk) }
    }
  }

  const reranked = await rerankChunks(prompt.slice(0, 300), merged)
  console.log(`Multi-query HyDE: ${merged.length} unique -> ${reranked.length} after rerank`)
  return reranked
}

// ─── TABLE EXTRACTION — structured DB approach ────────────────────────────────
// Fetches technology + results + validation summaries from DB, grouped by project.
// Processes each project individually so tech and results are always co-located.

const GARBAGE_NAMES = new Set([
  'deliverable','annex','public','amendment','grant','periodic','latest',
  'publ','viss','report','appendix','section','chapter','abstract',
  'multiple'  // IS2H4C data incorrectly indexed under this placeholder name
])

// Strings the reindexer writes when IRIS has no real technology in a project.
// Any iris_technology field containing these is treated as empty.
const NON_TECH_MARKERS = [
  'iris role in this project is non-technical',
  'no technology development by iris',
  'iris technology not separately identified',
  'non-technical — no technology',
  'non-technical - no technology',
  'purely administrative',
  'coordination, dissemination',
]

// Technology cell values that are junk — company names, single generic words, etc.
const JUNK_TECH_EXACT = new Set([
  // Generic structural words
  'project','technology','platform','system','solution','iris','partner',
  'consortium','software','hardware','tool','method','approach','process',
  'framework','service','module','component','device','prototype',
  // Unqualified technique names — must always be qualified with type/wavelength/application
  'spectroscopy','photonics','imaging','sensors','sensor','analytics',
  'analyzers','analyser','analyzes','monitoring','detection','analysis',
  'processing','algorithms','algorithm','models','model','data','database',
  // Unqualified biology/chemistry/engineering terms
  'extraction','coating','materials','material','instruments','instrument',
])

function isGarbageProject(name: string): boolean {
  const n = name.toLowerCase().trim()
  return GARBAGE_NAMES.has(n) || /^\d+$/.test(n) || n.length < 3
}

function isJunkTechnology(tech: string): boolean {
  const t = tech.toLowerCase().trim()
  if (t.length < 5) return true
  if (JUNK_TECH_EXACT.has(t)) return true
  // Company name leaked as technology (SUPREME, MYCOSPEC issues)
  if (t.startsWith('iris technology solutions')) return true
  if (t === 'iris technology solutions') return true
  // Non-technical fallback text bled into a row
  if (NON_TECH_MARKERS.some(m => t.includes(m))) return true
  return false
}

function hasRealTechContent(text: string): boolean {
  if (!text || text.length < 50) return false
  const lower = text.toLowerCase()
  return !NON_TECH_MARKERS.some(m => lower.includes(m))
}

async function extractRowsForProject(project: ProjectSummaryGroup): Promise<string[][]> {
  const irisTechText   = project.dimensions['iris_technology'] || ''
  const resultsText    = project.dimensions['iris_results']    || ''
  const validationText = project.dimensions['iris_validation'] || ''
  const roleText       = project.dimensions['iris_role']       || ''

  // Clean project name
  const cleanName = project.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || project.project_name
  if (isGarbageProject(cleanName)) return []

  // Use hasRealTechContent to exclude the ~90-char non-technical fallback strings
  // that the reindexer writes when IRIS has no technology in a project.
  const hasIrisTech = hasRealTechContent(irisTechText)
  const hasRole     = roleText.length > 20

  // Skip if nothing IRIS-specific available
  if (!hasIrisTech && !hasRole) return []

  let context: string
  let systemPrompt: string

  if (hasIrisTech) {
    // Best case — iris_technology from deliverables
    context = [
      `[IRIS TECHNOLOGY]: ${irisTechText}`,
      resultsText.length > 100 ? `[RESULTS]: ${resultsText}` : '',
      validationText.length > 100 ? `[VALIDATION]: ${validationText}` : ''
    ].filter(Boolean).join('\n\n')

    systemPrompt = `Extract table rows for a single IRIS project. Return ONLY a JSON array of arrays.
CRITICAL: Extract ONLY technologies explicitly named in the provided [IRIS TECHNOLOGY] text. Do NOT invent, infer, or copy technologies from other projects.
STRICT RULES:
(1) ONE row per distinct technology named in the input text. Return exactly as many rows as there are distinct named technologies.
(2) TECHNOLOGY: copy the name EXACTLY as it appears in the input text. Do not paraphrase or substitute.
    Include BOTH photonics/spectroscopy AND software/digital/platform technologies if named in the text.
    NEVER invent technology names not present in the input.
    FORBIDDEN technology names: "IRIS Technology Solutions", "project", "technology", "platform", "system", "solution", "photonics", "software", "tool" as standalone words.
(3) PARAMETER MONITORED: copy the exact parameter/substance/property being measured from ANY of the provided texts, or "" if not stated.
(4) RESULTS OBTAINED: copy quantitative outcomes from ANY of the provided texts — numbers, %, TRL, accuracy, RMSE, LOD, measurements. Look in [IRIS TECHNOLOGY], [RESULTS], and [VALIDATION]. Use "" only if no quantitative result is stated anywhere.
(5) If no specifically named technologies appear in the input text: return [].
Return [] if uncertain. No markdown, no preamble. JSON only.`

  } else {
    // Fallback — derive ONLY from iris_role. Do NOT use legacy technology dimension
    // (it contains all consortium technologies, not just IRIS's contribution).
    context = `[IRIS ROLE IN PROJECT]: ${roleText}`
    if (resultsText.length > 20) context += `\n\n[RESULTS]: ${resultsText}`

    systemPrompt = `Based ONLY on the IRIS ROLE description, extract specific technologies or digital platforms IRIS developed or operated.
Do NOT invent technologies not explicitly mentioned in IRIS's role.
Include BOTH photonics/spectroscopy AND software/digital/platform technologies if named in the role description.
If IRIS's role is purely administrative (coordination, reporting, dissemination) with NO named technology or platform: return [].
Return ONLY a JSON array of arrays.
STRICT RULES:
(1) ONE row per technology/platform IRIS was responsible for.
(2) TECHNOLOGY: exact name from the role description only.
    NEVER output: company names, "project", "technology", "platform", "system" as standalone names.
(3) PARAMETER MONITORED: exact parameter name, or "" if not stated.
(4) RESULTS OBTAINED: quantitative outcomes only. Use "" if none.
Return [] if uncertain. No markdown, no preamble. JSON only.`
  }

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Project: ${cleanName} (${project.project_code})\n\n${context}\n\nReturn JSON array: [["Technology", "Parameter Monitored", "Results Obtained"], ...] — rows will be grouped by project downstream.` }
    ],
    temperature: 0,
    max_tokens: 1500
  })

  let raw = (res.choices[0].message.content || '[]').trim()
  if (raw.includes('```')) { raw = raw.split('```')[1]; if (raw.startsWith('json')) raw = raw.slice(4) }
  try {
    const rows = JSON.parse(raw.trim())
    if (!Array.isArray(rows)) return []
    return rows
      .filter((r: any) => Array.isArray(r) && r[0] && typeof r[0] === 'string' && r[0].length > 3)
      .filter((r: any) => !isJunkTechnology(r[0]))   // post-filter: strip company names, generic words, fallback text
      .map((r: string[]) => [r[0], cleanName, r[1] || '', r[2] || ''])
  } catch { return [] }
}

async function buildTableRows(prompt: string): Promise<string> {
  // Trigger on: table, technology/technologies, develop*, validation, TRL, results, prototype
  if (!/table|technolog|develop|validat|TRL|prototype|results|monitoring/i.test(prompt)) return ''

  // ── Graph-first: pull canonical technologies from kg_project_technologies ──
  const { data: kgRows, error: kgErr } = await supabase
    .from('kg_project_technologies')
    .select('project_code, kg_technologies(name, category)')
    .eq('iris_developed', true)

  const graphTechMap = new Map<string, string[]>()
  if (!kgErr && kgRows?.length) {
    for (const row of kgRows as any[]) {
      const code = (row.project_code || '').toUpperCase()
      const techName = row.kg_technologies?.name
      if (!code || !techName || isJunkTechnology(techName)) continue
      if (!graphTechMap.has(code)) graphTechMap.set(code, [])
      graphTechMap.get(code)!.push(techName)
    }
    console.log(`Table extraction (graph): ${graphTechMap.size} projects with canonical technologies`)
  }

  // ── Load summaries for result/parameter strings (still needed) ────────────
  const projects = await fetchSummariesByDimension([
    'iris_technology', 'iris_results', 'iris_validation', 'iris_role'
  ])
  console.log(`Table extraction: ${projects.length} projects loaded`)

  const perProjectRows = new Map<string, { techs: string[], params: string[], results: string[] }>()

  // Pass 1: graph path for projects that have kg entries
  for (const p of projects) {
    const code = p.project_code.toUpperCase()
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    if (isGarbageProject(cleanName)) continue
    const graphTechs = graphTechMap.get(code)
    if (graphTechs?.length) {
      perProjectRows.set(cleanName, { techs: graphTechs, params: [], results: [] })
    }
  }
  console.log(`Table extraction: ${perProjectRows.size} projects covered by graph, ${projects.length - perProjectRows.size} need LLM fallback`)

  // Pass 2: LLM fallback only for projects with no graph data
  const needLLM = projects.filter(p => {
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    return !perProjectRows.has(cleanName) && !isGarbageProject(cleanName)
  })

  if (needLLM.length > 0) {
    const BATCH = 10
    for (let i = 0; i < needLLM.length; i += BATCH) {
      const batch = needLLM.slice(i, i + BATCH)
      const batchResults = await Promise.all(batch.map(p => extractRowsForProject(p)))
      for (let j = 0; j < batch.length; j++) {
        const rows = batchResults[j]
        if (rows.length === 0) continue
        const projectName = rows[0][1]
        if (!perProjectRows.has(projectName)) {
          perProjectRows.set(projectName, { techs: [], params: [], results: [] })
        }
        const entry = perProjectRows.get(projectName)!
        for (const row of rows) {
          if (row[0] && !entry.techs.includes(row[0])) entry.techs.push(row[0])
          if (row[2] && !entry.params.includes(row[2])) entry.params.push(row[2])
          if (row[3] && !entry.results.includes(row[3])) entry.results.push(row[3])
        }
      }
    }
  }

  if (perProjectRows.size === 0) return ''

  // Collapse to one row per project with result strings from summaries
  const allRows: string[][] = []
  for (const p of projects) {
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    const entry = perProjectRows.get(cleanName)
    if (!entry) continue

    let resultStr = entry.results.join('; ')
    if (!resultStr) {
      const raw = [p.dimensions['iris_results'] || '', p.dimensions['iris_validation'] || ''].join(' ')
      const matches = raw.match(/(?:TRL\s*\d+(?:[\s-]+to[\s-]+TRL\s*\d+)?|R²\s*(?:of\s*)?[\d.]+|RMSE[CV]*\s*(?:of\s*)?[\d.]+|[\d]+(?:\.\d+)?\s*%|>\s*[\d]+\s*%|<\s*[\d]+\s*%|accuracy[^,;.]{0,50}|[\d]+\s*samples?\s*(?:correctly\s*classified)?)/gi) || []
      const unique = [...new Set(matches.map(m => m.trim()))].slice(0, 5)
      resultStr = unique.filter(u => !/(accuracy metrics|were not|instruments were|models or)/i.test(u)).join('; ')
    }

    allRows.push([cleanName, entry.techs.join(', '), entry.params.join(', '), resultStr])
  }

  allRows.sort((a, b) => a[0].localeCompare(b[0]))
  console.log(`Table extraction complete: ${allRows.length} project rows`)
  return JSON.stringify(allRows)
}

// ─── SECTION CONTENT — structured DB approach ────────────────────────────────

const SECTOR_KEYWORDS: Array<{ sector: string; keywords: RegExp; applications: string }> = [
  { sector: 'Food, Beverage & Agriculture',      applications: 'Food safety & contaminant detection, quality assurance, supply chain monitoring, mycotoxin & pesticide analysis',        keywords: /food|agri|feed|crop|spice|grain|rice|meat|dairy|beverage|turmeric|mycotoxin|fish|fruit|vegetable|milk|cheese|chocolate|beer|wine|flour|bak|cereal|poultry|packag.*food|food.*packag|baby.safe|nutr|seed|harvest|germination|malt|brew/i },
  { sector: 'Pharma, Biotech & Life Sciences',   applications: 'Process analytical technology, bioprocess monitoring, inline quality control, drug formulation analysis',               keywords: /pharm|drug|medic|clinic|bioreactor|CAR.?T|health|patient|therapeut|biopharma|antibiot|biosens|diagnostic|wound|tissue|cell|protein|enzyme|fermenta/i },
  { sector: 'Circular Economy & Recycling',      applications: 'Material identification & sorting, recyclability assessment, waste stream characterisation, digital product passports',  keywords: /recycl|circular|waste|end.of.life|upcycl|second.life|take.back|demanufactur|remanufactur|reuse|recover.*material|material.*recover/i },
  { sector: 'Plastics, Polymers & Composites',   applications: 'Polymer characterisation, multilayer packaging analysis, coating & film inspection, barrier property monitoring',       keywords: /plastic|polymer|composite|fibre|fiber|rubber|resin|PET|polyethyl|polypropyl|bioplastic|multilayer|laminate|elastomer/i },
  { sector: 'Textiles & Fashion',                applications: 'Fibre composition analysis, dye & chemical monitoring, smart textile integration, production quality control',           keywords: /textil|fabric|garment|clothing|fashion|fibre|yarn|dye|cotton|wool|nylon|apparel/i },
  { sector: 'Energy & Clean Tech',               applications: 'Solar process monitoring, energy efficiency optimisation, biofuel production monitoring, clean energy systems',         keywords: /energy|solar|photovoltaic|OLED|battery|fuel.cell|biofuel|hydrogen|wind|power|electr.*produc|renewable|heat|thermal|CO2.*captur|decarboni/i },
  { sector: 'Environment & Water',               applications: 'Water quality monitoring, pollutant detection, environmental sensing, remediation process control',                      keywords: /water|environment|soil|pollut|contaminant|remediat|emission|climate|algae|biomass|aqua|marine|ocean|river|waste.?water/i },
  { sector: 'Construction & Built Environment',  applications: 'Building energy monitoring, material inspection, indoor environment quality, structural assessment',                     keywords: /build|construct|cement|concrete|infrastructure|retrofit|renovati|urban|architect|insulation|facade|HVAC/i },
  { sector: 'Cultural Heritage & Conservation',  applications: 'Artefact condition monitoring, non-invasive material analysis, environmental sensing in archives',                       keywords: /heritage|museum|artefact|artifact|conservat|archaeolog|cultural|monument|restora/i },
  { sector: 'Digital Platforms & Industrial IoT',applications: 'Cloud-based data management, supply chain digital twins, predictive maintenance, industrial IoT dashboards',            keywords: /digital|platform|IoT|Industry 4|smart.*factor|SaaS|supply.chain|data.manage|cloud|dashboard|sensor.network|predictive.mainten|industrial.symbiosis/i },
  { sector: 'Advanced Manufacturing',            applications: 'Inline process monitoring, PAT implementation, laser surface structuring, quality control automation',                  keywords: /manufactur|production|process|quality.control|inline.*monitor|PAT|process.analyt|automation|robot|laser.*surface|drying|extrusion|moulding/i },
]

function classifyProjectSector(appText: string): { sector: string; applications: string } {
  for (const { sector, keywords, applications } of SECTOR_KEYWORDS) {
    if (keywords.test(appText)) return { sector, applications }
  }
  return { sector: 'Other', applications: '' }
}

function buildSectorTable(projects: ProjectSummaryGroup[], groundedNames?: Set<string>): { headers: string[]; rows: string[][] } {
  const validProjects = projects.filter(p => {
    if (!p.dimensions['applications']) return false
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    if (isGarbageProject(cleanName)) return false
    if (groundedNames && groundedNames.size > 0 && !groundedNames.has(cleanName.toUpperCase())) return false
    return true
  })

  // Group by sector
  const sectorMap = new Map<string, { projects: string[]; applications: string }>()
  for (const p of validProjects) {
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    const appText = p.dimensions['applications'] || ''
    const { sector, applications } = classifyProjectSector(appText)
    if (!sectorMap.has(sector)) sectorMap.set(sector, { projects: [], applications })
    sectorMap.get(sector)!.projects.push(cleanName)
  }

  // Sort sectors by predefined order, then build rows — one row per sector
  const sectorOrder = SECTOR_KEYWORDS.map(s => s.sector).concat(['Other'])
  const rows: string[][] = []
  for (const sector of sectorOrder) {
    const entry = sectorMap.get(sector)
    if (!entry || entry.projects.length === 0) continue
    rows.push([sector, entry.projects.join(', '), entry.applications])
  }

  return { headers: ['Sector', 'Projects', 'Application Areas'], rows }
}

function buildRolesTable(projects: ProjectSummaryGroup[]): { headers: string[]; rows: string[][] } {
  const COORD_KW    = /\bcoordinator\b|project.coordinator|led.by.iris|iris.*coordinator|iris.*is.the.coordinator/i
  const WP_KW       = /work.package|\bWP\b.*lead|lead.*\bWP\b|WP\s*\d+.*lead|lead.*WP\s*\d+/i
  const TASK_KW     = /task.lead|lead.*task|task.\d+/i
  const DISSEM_KW   = /disseminat|communicat|exploit|stakeholder|outreach|public.*aware/i
  const MGMT_KW     = /manag|reporting|admin|financial.*manag|legal.*manag|ethics|data.management.plan/i

  const rows: string[][] = []

  const byRole = new Map<string, string[]>([
    ['Project Coordinator', []],
    ['Work Package Leader', []],
    ['Task Leader', []],
    ['Dissemination & Communication', []],
    ['Project Management', []],
    ['Other Non-Technical', []],
  ])

  for (const p of projects) {
    const roleText = p.dimensions['iris_role'] || ''
    if (!roleText || isGarbageProject(p.project_name)) continue
    const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
    const lower = roleText.toLowerCase()
    const hasNonTech = /coord|disseminat|communicat|exploit|stakeholder|work.package|\bWP\b|task.lead|manag|reporting|admin/i.test(roleText)
    if (!hasNonTech) continue

    if (COORD_KW.test(roleText))   byRole.get('Project Coordinator')!.push(cleanName)
    else if (WP_KW.test(roleText)) byRole.get('Work Package Leader')!.push(cleanName)
    else if (TASK_KW.test(roleText)) byRole.get('Task Leader')!.push(cleanName)
    else if (DISSEM_KW.test(roleText)) byRole.get('Dissemination & Communication')!.push(cleanName)
    else if (MGMT_KW.test(roleText)) byRole.get('Project Management')!.push(cleanName)
    else byRole.get('Other Non-Technical')!.push(cleanName)
  }

  for (const [role, names] of byRole) {
    if (names.length === 0) continue
    rows.push([role, String(names.length), names.join(', ')])
  }

  return { headers: ['Non-Technical Role', '# Projects', 'Projects'], rows }
}

async function buildSectionContent(prompt: string, groundedNames?: Set<string>): Promise<{ sectorsTable?: { headers: string[]; rows: string[][] }; rolesTable?: { headers: string[]; rows: string[][] } }> {
  const needsSectors = /sector|application|industr|use.?case|market/i.test(prompt)
  const needsRoles   = /role|non.?technical|management|coordinator|disseminat/i.test(prompt)

  if (!needsSectors && !needsRoles) return {}

  const dims = ['applications', 'iris_role']
  const projects = await fetchSummariesByDimension(dims)
  console.log(`Section content: ${projects.length} projects fetched for sectors/roles`)

  const result: { sectorsTable?: { headers: string[]; rows: string[][] }; rolesTable?: { headers: string[]; rows: string[][] } } = {}

  if (needsSectors) {
    // Graph-first: use kg_project_domains for authoritative sector classification
    const { data: domainRows } = await supabase
      .from('kg_project_domains')
      .select('project_code, domain')

    // Build domain → [projects] map from graph
    const graphDomainMap = new Map<string, string[]>()
    const codeToDomains = new Map<string, string[]>()
    if (domainRows?.length) {
      for (const row of domainRows as any[]) {
        const code = (row.project_code || '').toUpperCase()
        const domain = (row.domain || '').trim()
        if (!code || !domain) continue
        if (!codeToDomains.has(code)) codeToDomains.set(code, [])
        codeToDomains.get(code)!.push(domain)
      }
    }

    // Build sector table: group project codes by their primary domain
    const sectorMap = new Map<string, string[]>()
    const graphCoveredCodes = new Set<string>()
    for (const p of projects) {
      const code = p.project_code.toUpperCase()
      const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
      if (isGarbageProject(cleanName)) continue
      if (groundedNames && groundedNames.size > 0 && !groundedNames.has(cleanName.toUpperCase())) continue
      const domains = codeToDomains.get(code)
      if (domains?.length) {
        graphCoveredCodes.add(code)
        const primaryDomain = domains[0]
        if (!sectorMap.has(primaryDomain)) sectorMap.set(primaryDomain, [])
        sectorMap.get(primaryDomain)!.push(cleanName)
      }
    }

    // Fallback: regex classification for projects not in graph
    for (const p of projects) {
      const code = p.project_code.toUpperCase()
      if (graphCoveredCodes.has(code)) continue
      const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
      if (isGarbageProject(cleanName)) continue
      if (groundedNames && groundedNames.size > 0 && !groundedNames.has(cleanName.toUpperCase())) continue
      const appText = p.dimensions['applications'] || ''
      if (!appText) continue
      const { sector } = classifyProjectSector(appText)
      if (!sectorMap.has(sector)) sectorMap.set(sector, [])
      sectorMap.get(sector)!.push(cleanName)
    }

    if (sectorMap.size > 0) {
      const rows = [...sectorMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sector, names]) => [sector, names.join(', '), ''])
      const table = { headers: ['Sector', 'Projects', 'Application Areas'], rows }
      result.sectorsTable = table
      console.log(`Sectors table (graph+fallback): ${rows.length} sectors, ${[...sectorMap.values()].flat().length} projects`)
    }
  }

  if (needsRoles) {
    // Graph-first: use kg_projects.iris_functional_roles
    const { data: kgProjects } = await supabase
      .from('kg_projects')
      .select('code, full_name, iris_functional_roles')

    const graphRolesMap = new Map<string, string[]>() // code → roles[]
    if (kgProjects?.length) {
      for (const row of kgProjects as any[]) {
        const code = (row.code || '').toUpperCase()
        const roles: string[] = row.iris_functional_roles || []
        if (code && roles.length) graphRolesMap.set(code, roles)
      }
    }

    // Build roles table from graph data
    const byRole = new Map<string, string[]>([
      ['Project Coordinator', []],
      ['Work Package Leader', []],
      ['Task Leader', []],
      ['Dissemination & Communication', []],
      ['Project Management', []],
      ['Other Non-Technical', []],
    ])

    const graphCoveredRoles = new Set<string>()
    for (const p of projects) {
      const code = p.project_code.toUpperCase()
      const cleanName = p.project_name.replace(/^TERM[-_]/i, '').replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '').replace(/^DOMAIN_/i, '').replace(/^\d+[-\s]+/, '').trim() || p.project_name
      if (isGarbageProject(cleanName)) continue
      const roles = graphRolesMap.get(code)
      if (roles?.length) {
        graphCoveredRoles.add(code)
        if (roles.includes('coordinator'))        byRole.get('Project Coordinator')!.push(cleanName)
        else if (roles.includes('wp_leader'))     byRole.get('Work Package Leader')!.push(cleanName)
        else if (roles.includes('task_leader'))   byRole.get('Task Leader')!.push(cleanName)
        else if (roles.includes('dissemination')) byRole.get('Dissemination & Communication')!.push(cleanName)
        else if (roles.includes('project_management')) byRole.get('Project Management')!.push(cleanName)
        else                                      byRole.get('Other Non-Technical')!.push(cleanName)
      }
    }

    // Fallback: regex for projects not in graph
    const fallbackProjects = projects.filter(p => !graphCoveredRoles.has(p.project_code.toUpperCase()))
    const fallbackTable = buildRolesTable(fallbackProjects)
    for (const row of fallbackTable.rows) {
      const roleList = byRole.get(row[0])
      if (roleList) {
        const names = row[2].split(', ').filter(Boolean)
        for (const n of names) if (!roleList.includes(n)) roleList.push(n)
      }
    }

    const rows: string[][] = []
    for (const [role, names] of byRole) {
      if (names.length === 0) continue
      rows.push([role, String(names.length), names.join(', ')])
    }
    if (rows.length > 0) {
      result.rolesTable = { headers: ['Non-Technical Role', '# Projects', 'Projects'], rows }
      console.log(`Roles table (graph+fallback): ${rows.length} role categories`)
    }
  }

  return result
}

// ─── PARTNER CONTEXT FROM GRAPH ──────────────────────────────────────────────

async function buildPartnerContext(prompt: string, projectTags: string[]): Promise<string> {
  if (!/consortium|partner|collaborat|member.*organisation|organisation.*member/i.test(prompt)) return ''

  let query = supabase
    .from('kg_project_partners')
    .select('project_code, role, kg_partners(name, country_code, partner_type)')

  if (projectTags.length > 0) {
    query = query.in('project_code', projectTags)
  } else {
    query = query.limit(200)
  }

  const { data, error } = await query
  if (error || !data?.length) return ''

  // Aggregate per partner: count appearances, collect projects and roles
  const partnerMap = new Map<string, { country: string; type: string; projects: string[]; roles: Set<string> }>()
  for (const row of data as any[]) {
    const name = row.kg_partners?.name
    if (!name) continue
    if (!partnerMap.has(name)) {
      partnerMap.set(name, { country: row.kg_partners?.country_code || '', type: row.kg_partners?.partner_type || '', projects: [], roles: new Set() })
    }
    const entry = partnerMap.get(name)!
    if (row.project_code && !entry.projects.includes(row.project_code)) entry.projects.push(row.project_code)
    if (row.role) entry.roles.add(row.role)
  }

  const lines = [...partnerMap.entries()]
    .sort((a, b) => b[1].projects.length - a[1].projects.length)
    .slice(0, 50)
    .map(([name, e]) => `- ${name} (${e.country || '?'}, ${e.type || 'unknown'}) — ${e.projects.length} project(s): ${e.projects.slice(0, 5).join(', ')}${e.projects.length > 5 ? '...' : ''}`)

  return lines.length > 0 ? `## Past IRIS Consortium Partners\n\n${lines.join('\n')}` : ''
}

// ─── STRUCTURE GENERATION ────────────────────────────────────────────────────

async function generateStructure(prompt: string, context: string, type: string, needsTable = false) {
  const systemDocx = `You are a technical writer for IRIS Technology Solutions. Generate a Word document structure as JSON only.
Format:
{
  "title": "...",
  "subtitle": "...",
  "executive_summary": "...",
  "sections": [
    {
      "heading": "...",
      "level": 1,
      "body": "...",
      "table": { "headers": ["..."], "rows": [["val", "val"]] },
      "subsections": [{ "heading": "...", "level": 2, "body": "..." }]
    }
  ],
  "references": ["Project Name (Code)"]
}
Rules:
- Use ONLY information explicitly stated in the context. Never invent facts.
- For table sections: use pre-extracted rows exactly as provided — do not add, remove, or modify rows. Table columns are: Project | Technologies Developed | Parameters Monitored | Results Obtained.
- For all sections: write detailed prose naming specific projects. No generic boilerplate.
- Only include Sectors/Applications or Non-Technical Roles sections if explicitly requested in the prompt.
- Each non-placeholder section body must be at least 150 words of specific content.
- References: list project codes/names used.
- Use subsections (level:2) for any section covering 3 or more distinct sub-topics. For example, a "Technologies Being Developed" section should have one Heading2 subsection per technology type.

CRITICAL FORMATTING — body and subsection body fields must be plain prose only:
- NO markdown: no **bold**, no *italic*, no bullet dashes (- item), no numbered lists, no asterisks
- Write flowing sentences and paragraphs only — never inline lists
- For structured content use the subsections array with heading + body, not inline lists in body text
- Every sentence must name a specific project — never write generic statements without naming the project`

  const systemPptx = `You are a technical writer for IRIS Technology Solutions. Generate a PowerPoint structure as JSON only.
Format:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "title": "...", "layout": "title_content", "bullets": ["..."], "notes": "2-3 sentences of speaker notes." },
    { "title": "...", "layout": "two_column", "left": ["..."], "right": ["..."], "notes": "..." },
    { "title": "...", "layout": "big_stat", "stat": "95%", "label": "...", "body": "...", "notes": "..." },
    { "title": "...", "layout": "section_break", "subtitle": "..." },
    { "title": "...", "layout": "chart_slide", "chartType": "bar", "labels": ["Label A","Label B"], "values": [85, 60], "unit": "%", "notes": "..." }
  ]
}
Generate 8-12 slides.

MANDATORY DIVERSITY RULES — you MUST emit AT LEAST:
  • 1 section_break (as the 2nd slide to set narrative arc, or before a major topic change)
  • 1 big_stat (the single most striking number: total funding, project count, TRL achieved, % improvement)
  • 1 two_column (any "before vs after", "challenge vs IRIS solution", "photonics vs digital", or comparing two project clusters)
  • 1 chart_slide OR table_slide (chart only if all values share ONE unit; otherwise table)
AT MOST 60% of content slides may use title_content. If you cannot meet diversity rules with the available context, prefer table_slide and big_stat over duplicating title_content.

Per-layout requirements:
- title_content: 3-6 bullets, each naming a specific project + specific outcome. "notes" required.
- two_column: left[] and right[] arrays of 2-4 items each. Use for parallel comparisons. "notes" required.
- big_stat: ONE stat string (e.g. "€12.4M", "49 projects", "TRL 7"). 1-line label. 2-3 sentence body. "notes" required.
- section_break: title + subtitle only. Narrative divider — no bullets, no notes needed.
- chart_slide: chartType="bar". labels[] and values[] same length, 2-7 entries. ALL values share ONE unit — set "unit" field. NEVER mix percentages with absolute counts. "notes" required.
- table_slide: 3-5 columns, 3-8 rows. Use for project rosters, KPI matrices, technology x application maps.

Content rules:
- Use ONLY information explicitly stated in the context. Never invent facts.
- Each bullet must name a specific project and specific technology or result — no generic statements.
- EVERY slide except section_break MUST have a "notes" field: 2-3 sentences of speaker elaboration adding context not shown on the slide.
- CRITICAL: Every slide except section_break must have substantive content. Never emit a slide with only a title.
- For Q&A/closing slides: notes should suggest talking points or anticipated audience questions.

EXAMPLE deck shape for "Overview of IRIS Horizon Europe projects":
  Slide 1: title_content  — Mission overview (3 bullets naming specific programmes)
  Slide 2: section_break  — "The IRIS Project Portfolio"
  Slide 3: big_stat       — "49 projects" / EU funding headline
  Slide 4: table_slide    — Project | TRL | Application | Status (6 rows)
  Slide 5: two_column     — Photonics technologies | Digital platforms
  Slide 6: title_content  — Pharma sector projects (FOODSAFER, BIORADAR, FREEME)
  Slide 7: title_content  — Industrial automation projects (ASTEP, INPERSO)
  Slide 8: section_break  — "Outcomes & Impact"
  Slide 9: chart_slide    — TRL achieved per project (unit: "TRL level", values 1-9)
  Slide 10: title_content — Cross-project lessons learned
  Slide 11: title_content — Q&A (with notes suggesting anticipated questions)
Result: 6 distinct layouts, 2 section breaks, big headline number, comparison, data viz, project table.`

  const tableHint = (needsTable && type === 'pptx')
    ? `\n\nIMPORTANT: Answer ALL questions fully. Use table_slide layout for the table, then continue with sectors/roles slides. Do not stop after the table. Use pre-extracted rows exactly as given.`
    : ''

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: type === 'pptx' ? systemPptx : systemDocx },
      { role: 'user', content: `Context from IRIS knowledge base:\n${context}\n\nGenerate a ${type === 'pptx' ? 'presentation' : 'document'} about: ${prompt}${tableHint}` }
    ],
    temperature: 0.2,
    max_tokens: 6000
  })

  let raw = completion.choices[0].message.content || ''
  if (raw.includes('```')) { raw = raw.split('```')[1]; if (raw.startsWith('json')) raw = raw.slice(4) }
  return JSON.parse(raw.trim())
}

// ─── DOCX BUILDER ────────────────────────────────────────────────────────────

function deduplicateChunks(chunks: any[]): any[] {
  const seen = new Set<string>()
  const result: any[] = []
  for (const c of chunks) {
    const key = c.id != null ? String(c.id) : `${c.source_file}|${c.page_number}|${(c.chunk_text || '').slice(0, 60)}`
    if (!seen.has(key)) { seen.add(key); result.push(c) }
  }
  return result.sort((a, b) => b.similarity - a.similarity)
}

function cleanSourceFile(name: string): string {
  if (!name) return name
  return name
    .replace(/^TERMINATED__/i, '')
    .replace(/^TERM[-_]/i, '')
    .replace(/^PB[A-Z0-9]{2,6}[-\s]+/i, '')
    .replace(/^\d{2,4}[-\s]+/, '')
    .trim()
}

function decodeHtmlEntities(s: string): string {
  if (!s) return s
  return s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function decodeStructure(obj: any): any {
  if (typeof obj === 'string') return decodeHtmlEntities(obj)
  if (Array.isArray(obj)) return obj.map(decodeStructure)
  if (obj && typeof obj === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(obj)) out[k] = decodeStructure(v)
    return out
  }
  return obj
}

function diversifyChunks(chunks: any[], capPerFilePage = 2, target = 10): any[] {
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

function checkLayoutDiversity(structure: any): { ok: boolean; reason?: string } {
  const slides = Array.isArray(structure?.slides) ? structure.slides : []
  if (slides.length < 6) return { ok: true }
  const layouts = slides.map((s: any) => s?.layout || 'title_content')
  const counts: Record<string, number> = {}
  for (const L of layouts) counts[L] = (counts[L] || 0) + 1
  const distinct = Object.keys(counts).length
  const titleContentRatio = (counts['title_content'] || 0) / slides.length
  if (distinct < 3) return { ok: false, reason: `Only ${distinct} distinct layouts used; need at least 3.` }
  if (titleContentRatio > 0.7) return { ok: false, reason: `${Math.round(titleContentRatio * 100)}% of slides use title_content; cap is 60%.` }
  if (!layouts.some((L: string) => L === 'section_break' || L === 'big_stat')) {
    return { ok: false, reason: 'Need at least one section_break or big_stat for narrative anchoring.' }
  }
  return { ok: true }
}

function stripMarkdown(text: string): string {
  if (!text) return text
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/\_\_(.+?)\_\_/gs, '$1')
    .replace(/\_(.+?)\_/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\-\*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .trim()
}

function buildDocxTable(tableData: { headers: string[], rows: string[][] }) {
  const headerRow = new TableRow({
    children: tableData.headers.map(h =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: IRIS_WHITE })] })],
        shading: { fill: IRIS_DARK },
        width: { size: Math.floor(100 / tableData.headers.length), type: WidthType.PERCENTAGE },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 1, color: IRIS_CYAN },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: IRIS_CYAN },
          left:   { style: BorderStyle.SINGLE, size: 1, color: IRIS_CYAN },
          right:  { style: BorderStyle.SINGLE, size: 1, color: IRIS_CYAN },
        }
      })
    )
  })

  const dataRows = tableData.rows.map((row, rowIdx) =>
    new TableRow({
      children: row.map(cell =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: cell, size: 18 })] })],
          shading: { fill: rowIdx % 2 === 0 ? 'F0F9FA' : 'FFFFFF' },
          width: { size: Math.floor(100 / row.length), type: WidthType.PERCENTAGE },
          borders: {
            top:    { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E0' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E0' },
            left:   { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E0' },
            right:  { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E0' },
          }
        })
      )
    })
  )

  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } })
}

async function buildDocx(structure: any, chunks: any[] = []): Promise<Buffer> {
  const children: any[] = []

  // Pre-compute deduped chunks and build footnote definitions upfront
  const dedupedChunks = diversifyChunks(deduplicateChunks(chunks), 2, 10)
  const fnLimit = Math.min(dedupedChunks.length, 20)
  const footnoteMap: Record<number, { children: any[] }> = {}
  for (let i = 0; i < fnLimit; i++) {
    const c = dedupedChunks[i]
    footnoteMap[i + 1] = {
      children: [new Paragraph({
        children: [new TextRun({
          text: `${cleanSourceFile(c.source_file)}, p.\u00a0${c.page_number} (${(c.similarity * 100).toFixed(0)}% relevance)`,
          size: 18, color: '64748B'
        })]
      })]
    }
  }
  let fnCounter = 0
  const nextFnRef = (): FootnoteReferenceRun | null => {
    if (fnCounter >= fnLimit) return null
    fnCounter++
    return new FootnoteReferenceRun(fnCounter)
  }

  children.push(new Paragraph({
    children: [new TextRun({ text: structure.title || 'IRIS Report', bold: true, size: 52, color: IRIS_DARK })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 }
  }))
  if (structure.subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: structure.subtitle, size: 28, color: IRIS_CYAN })],
      spacing: { after: 100 }
    }))
  }
  children.push(new Paragraph({
    children: [new TextRun({
      text: `IRIS Technology Solutions | ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      size: 20, color: '64748B'
    })],
    spacing: { after: 600 }
  }))

  if (structure.executive_summary) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Executive Summary', bold: true, size: 32, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 }
    }))
    const fnRef = nextFnRef()
    children.push(new Paragraph({
      children: fnRef
        ? [new TextRun({ text: stripMarkdown(structure.executive_summary), size: 22 }), fnRef]
        : [new TextRun({ text: stripMarkdown(structure.executive_summary), size: 22 })],
      spacing: { after: 400 }
    }))
  }

  for (const section of (structure.sections || [])) {
    children.push(new Paragraph({
      children: [new TextRun({ text: section.heading, bold: true, size: section.level === 1 ? 30 : 26, color: section.level === 1 ? IRIS_DARK : '134D5C' })],
      heading: section.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 160 }
    }))
    if (section.body) {
      const fnRef = nextFnRef()
      children.push(new Paragraph({
        children: fnRef
          ? [new TextRun({ text: stripMarkdown(section.body), size: 22 }), fnRef]
          : [new TextRun({ text: stripMarkdown(section.body), size: 22 })],
        spacing: { after: 240 }
      }))
    }
    if (section.table?.headers?.length && section.table?.rows?.length) {
      children.push(new Paragraph({ children: [], spacing: { before: 200 } }))
      children.push(buildDocxTable(section.table))
      children.push(new Paragraph({ children: [], spacing: { after: 300 } }))
    }
    for (const sub of (section.subsections || [])) {
      children.push(new Paragraph({
        children: [new TextRun({ text: sub.heading, bold: true, size: 24, color: '134D5C' })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 }
      }))
      if (sub.body) {
        children.push(new Paragraph({
          children: [new TextRun({ text: stripMarkdown(sub.body), size: 22 })],
          spacing: { after: 200 }
        }))
      }
      if (sub.table?.headers?.length && sub.table?.rows?.length) {
        children.push(new Paragraph({ children: [], spacing: { before: 200 } }))
        children.push(buildDocxTable(sub.table))
        children.push(new Paragraph({ children: [], spacing: { after: 300 } }))
      }
    }
  }

  if (structure.references?.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Related Projects Mentioned', bold: true, size: 30, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 600, after: 200 }
    }))
    for (const ref of structure.references) {
      children.push(new Paragraph({
        children: [new TextRun({ text: ref, size: 20, color: '64748B' })],
        numbering: { reference: 'iris-bullets', level: 0 },
        spacing: { after: 100 }
      }))
    }
  }

  if (dedupedChunks.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Sources', bold: true, size: 30, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 600, after: 200 }
    }))
    for (const c of dedupedChunks.slice(0, 20)) {
      const label = `${cleanSourceFile(c.source_file)}  |  p${c.page_number}  |  ${(c.similarity * 100).toFixed(0)}% similarity`
      children.push(new Paragraph({
        children: [new TextRun({ text: label, size: 18, color: '64748B' })],
        spacing: { after: 80 }
      }))
    }
  }

  const doc = new Document({
    creator: 'IRIS Knowledge Base',
    description: structure.title || 'IRIS Report',
    footnotes: fnLimit > 0 ? footnoteMap : undefined,
    numbering: {
      config: [{
        reference: 'iris-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    },
    sections: [{ children }]
  })
  return await Packer.toBuffer(doc)
}

// ─── PPTX BUILDER ────────────────────────────────────────────────────────────

async function buildPptx(structure: any, chunks: any[] = []): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'IRIS Technology Solutions'
  pptx.title = structure.title || 'IRIS Report'
  pptx.subject = structure.title || 'IRIS Report'
  pptx.company = 'IRIS Technology Solutions'
  const defFont = 'Calibri'
  const t = {
    bg: IRIS_DARK, headerBg: '0D3A45', accent: IRIS_CYAN, white: IRIS_WHITE,
    cardBg: '0D3A45', cardBody: 'CBD5E1', muted: '64748B', subAccent: '1A4A57'
  }
  const F = defFont

  const slideNumOpts = { x: 12.5, y: 7.1, w: 0.7, h: 0.3, fontSize: 9, color: '334D5C', fontFace: F, align: 'right' as const }
  pptx.defineSlideMaster({ title: 'IRIS_CONTENT', background: { color: IRIS_DARK }, slideNumber: slideNumOpts })
  pptx.defineSlideMaster({ title: 'IRIS_SECTION', background: { color: '0D3A45' }, slideNumber: { ...slideNumOpts, color: IRIS_CYAN } })
  pptx.defineSlideMaster({ title: 'IRIS_BIG_STAT', background: { color: IRIS_DARK }, slideNumber: slideNumOpts })

  function masterFor(layout: string): string {
    if (layout === 'section_break') return 'IRIS_SECTION'
    if (layout === 'big_stat') return 'IRIS_BIG_STAT'
    return 'IRIS_CONTENT'
  }

  function addHeader(s: any, title: string) {
    s.background = { fill: t.bg }
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: t.headerBg }, line: { color: t.headerBg } })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.87, w: 13.33, h: 0.04, fill: { color: t.accent }, line: { color: t.accent } })
    s.addText(title, { x: 0.4, y: 0.1, w: 12.5, h: 0.7, fontSize: 22, bold: true, color: t.white, fontFace: F })
  }

  function addTable(s: any, headers: string[], rows: string[][], x: number, y: number, w: number) {
    const colW = w / headers.length
    const headerCells = headers.map(h => ({
      text: h, options: { bold: true, color: t.white, fill: t.bg, fontSize: 11, fontFace: F,
        border: [{ type: 'solid', color: t.accent, pt: 1 }] }
    }))
    const dataRows = rows.map((row, ri) =>
      row.map(cell => ({
        text: cell, options: { color: t.cardBody, fill: ri % 2 === 0 ? '0D3A45' : '0A2E36',
          fontSize: 10, fontFace: F, border: [{ type: 'solid', color: t.subAccent, pt: 1 }] }
      }))
    )
    s.addTable([headerCells, ...dataRows], { x, y, w, colW: Array(headers.length).fill(colW),
      rowH: 0.35, autoPage: false })
  }

  // Title slide
  const titleSlide = pptx.addSlide({ masterName: 'IRIS_CONTENT' })
  titleSlide.background = { fill: t.bg }
  titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 4.8, w: 13.33, h: 0.05, fill: { color: t.accent }, line: { color: t.accent } })
  titleSlide.addText(structure.title || 'IRIS Report', { x: 0.6, y: 1.5, w: 12, h: 1.5, fontSize: 38, bold: true, color: t.white, fontFace: F })
  titleSlide.addText(structure.subtitle || 'IRIS Technology Solutions', { x: 0.6, y: 3.2, w: 12, h: 0.6, fontSize: 18, color: t.accent, fontFace: F })
  titleSlide.addText(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, { x: 0.6, y: 5.2, w: 8, h: 0.4, fontSize: 12, color: t.muted, fontFace: F })
  titleSlide.addNotes(`Welcome to this presentation from IRIS Technology Solutions. This deck was generated from the IRIS knowledge base and covers ${structure.subtitle || 'our project portfolio'}. Please feel free to ask questions at the end.`)

  const MAX_ROWS_PER_SLIDE = 8

  for (const slide of (structure.slides || [])) {
    const layout = slide.layout || 'title_content'

    if (layout === 'table_slide') {
      const tbl = slide.table
      if (!tbl?.headers?.length || !tbl?.rows?.length) continue
      const allRows: string[][] = tbl.rows
      const chunks: string[][][] = []
      for (let i = 0; i < allRows.length; i += MAX_ROWS_PER_SLIDE) chunks.push(allRows.slice(i, i + MAX_ROWS_PER_SLIDE))
      chunks.forEach((rowChunk, ci) => {
        const s = pptx.addSlide({ masterName: 'IRIS_CONTENT' })
        const pageLabel = chunks.length > 1 ? ` (${ci+1}/${chunks.length})` : ''
        addHeader(s, (slide.title || '') + pageLabel)
        let tableY = 1.04
        if (ci === 0 && slide.intro) {
          s.addText(slide.intro, { x: 0.45, y: 1.04, w: 12.43, h: 0.4, fontSize: 11.5, color: t.cardBody, fontFace: F })
          tableY = 1.52
        }
        addTable(s, tbl.headers, rowChunk, 0.45, tableY, 12.43)
      })
      continue
    }

    const s = pptx.addSlide({ masterName: masterFor(layout) })
    addHeader(s, slide.title || '')

    if (layout === 'section_break') {
      s.background = { fill: t.headerBg }
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: t.headerBg }, line: { color: t.headerBg } })
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.8, w: 0.08, h: 1.5, fill: { color: t.accent }, line: { color: t.accent } })
      s.addText(slide.title || '', { x: 1, y: 2.8, w: 11, h: 1, fontSize: 34, bold: true, color: t.white, fontFace: F })
      if (slide.subtitle) s.addText(slide.subtitle, { x: 1, y: 3.9, w: 11, h: 0.6, fontSize: 16, color: t.accent, fontFace: F })
    } else if (layout === 'chart_slide') {
      const labels: string[] = Array.isArray(slide.labels) ? slide.labels : []
      const values: number[] = Array.isArray(slide.values) ? slide.values.map(Number) : []
      if (labels.length > 0 && values.length === labels.length) {
        const chartData = [{ name: slide.title || 'Values', labels, values }]
        s.addChart(pptx.ChartType.bar, chartData, {
          x: 0.5, y: 1.05, w: 12.33, h: 5.8,
          barDir: 'col',
          chartColors: [IRIS_CYAN],
          showValue: true,
          valAxisLabelColor: IRIS_WHITE,
          catAxisLabelColor: IRIS_WHITE,
          dataLabelColor: IRIS_WHITE,
          valAxisLineColor: '334D5C',
          catAxisLineColor: '334D5C',
          valGridLine: { style: 'solid', color: '1A4A57' },
          dataLabelFormatCode: slide.unit === '%' ? '0"%"' : '0',
          valAxisLabelFormatCode: slide.unit === '%' ? '0"%"' : '0',
        } as any)
      }
    } else if (layout === 'big_stat') {
      s.addText(slide.stat || '', { x: 1, y: 1.2, w: 5, h: 2, fontSize: 72, bold: true, color: t.accent, fontFace: F, align: 'center' })
      s.addText(slide.label || '', { x: 1, y: 3.2, w: 5, h: 0.6, fontSize: 16, color: t.white, fontFace: F, align: 'center' })
      if (slide.body) s.addText(slide.body, { x: 6.5, y: 1.2, w: 6.3, h: 4, fontSize: 14, color: t.cardBody, fontFace: F, valign: 'top' })
    } else if (layout === 'two_column') {
      const bulletOpts = (items: string[]) => items.map(txt => ({ text: txt, options: { bullet: { code: '2022' }, color: t.cardBody, fontSize: 13 } }))
      if (slide.left?.length)  s.addText(bulletOpts(slide.left),  { x: 0.4, y: 1.1, w: 6,   h: 5.5, fontFace: F, valign: 'top' })
      if (slide.right?.length) s.addText(bulletOpts(slide.right), { x: 6.9, y: 1.1, w: 6,   h: 5.5, fontFace: F, valign: 'top' })
      s.addShape(pptx.ShapeType.line, { x: 6.65, y: 1.1, w: 0, h: 5, line: { color: t.subAccent, width: 1 } })
    } else {
      const slideTitle = (slide.title || '').toLowerCase().trim()
      const bullets = (slide.bullets || slide.content || [])
        .filter((txt: string) => txt.toLowerCase().trim() !== slideTitle)
      if (bullets.length) {
        s.addText(
          bullets.map((txt: string) => ({ text: txt, options: { bullet: { code: '2022' }, color: t.cardBody, fontSize: 14, breakLine: true } })),
          { x: 0.6, y: 1.1, w: 12.1, h: 5.8, fontFace: F, valign: 'top', paraSpaceAfter: 6 }
        )
      }
    }
    if (slide.notes && layout !== 'section_break') s.addNotes(slide.notes)
    s.addText('IRIS Technology Solutions | Confidential', { x: 0.4, y: 7.1, w: 10, h: 0.3, fontSize: 9, color: t.subAccent, fontFace: F })
  }

  const dedupedChunksPptx = diversifyChunks(deduplicateChunks(chunks), 2, 10)
  if (dedupedChunksPptx.length > 0) {
    const srcSlide = pptx.addSlide({ masterName: 'IRIS_CONTENT' })
    srcSlide.background = { fill: t.bg }
    srcSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: t.headerBg }, line: { color: t.headerBg } })
    srcSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.87, w: 13.33, h: 0.04, fill: { color: t.accent }, line: { color: t.accent } })
    srcSlide.addText('Sources', { x: 0.4, y: 0.1, w: 12.5, h: 0.7, fontSize: 22, bold: true, color: t.white, fontFace: F })
    const srcLines = dedupedChunksPptx.slice(0, 20).map((c: any) =>
      ({ text: `${cleanSourceFile(c.source_file)}  |  p${c.page_number}  |  ${(c.similarity * 100).toFixed(0)}%`, options: { color: t.cardBody, fontSize: 10, fontFace: F, breakLine: true } })
    )
    srcSlide.addText(srcLines, { x: 0.4, y: 1.0, w: 12.5, h: 6.2, valign: 'top', paraSpaceAfter: 4 })
    srcSlide.addText('IRIS Technology Solutions | Confidential', { x: 0.4, y: 7.1, w: 10, h: 0.3, fontSize: 9, color: t.subAccent, fontFace: F })
    const srcFileSet = new Set(dedupedChunksPptx.map((c: any) => cleanSourceFile(c.source_file)))
    const srcFileList = [...srcFileSet].slice(0, 5).join(', ')
    const avgSim = Math.round(dedupedChunksPptx.reduce((a: number, c: any) => a + c.similarity, 0) / dedupedChunksPptx.length * 100)
    srcSlide.addNotes(`This deck draws on ${dedupedChunksPptx.length} retrieved passage${dedupedChunksPptx.length === 1 ? '' : 's'} across ${srcFileSet.size} source document${srcFileSet.size === 1 ? '' : 's'} (${srcFileList}${srcFileSet.size > 5 ? ', and others' : ''}). Average semantic similarity to the query: ${avgSim}%. All claims on the preceding slides are grounded in these passages — refer to the page numbers above for verification.`)
  }

  return await pptx.write({ outputType: 'nodebuffer' }) as Buffer
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { prompt, outputType } = await req.json()
    if (!prompt) return NextResponse.json({ error: 'No prompt provided' }, { status: 400 })

    const needsTable   = /table|list.*technolog|technolog.*list/i.test(prompt)
    const needsSectors = /\bsector[s]?\b|all.*application|application.*area|industr.*overview|market.*overview|portfolio.*sector/i.test(prompt)
    const needsRoles   = /non.?technical.role|all.*role|role.*overview|management.role|coordinator.role|disseminat.*role|iris.*role.*across|overall.*role/i.test(prompt)
    const needsSections = needsSectors || needsRoles
    const promptTags = detectProjectTags(prompt)

    // Run summaries + chunks + partner context in parallel, then table extraction
    const [summaryContext, chunks, preExtractedRows, partnerContext] = await Promise.all([
      querySummaries(prompt),
      retrieveChunks(prompt),
      needsTable ? buildTableRows(prompt) : Promise.resolve(''),
      buildPartnerContext(prompt, promptTags)
    ])

    // Build grounded project name set from table rows — sectors prose only describes confirmed projects
    let groundedNames: Set<string> | undefined
    if (preExtractedRows) {
      try {
        const rows: string[][] = JSON.parse(preExtractedRows)
        groundedNames = new Set(rows.map(r => (r[0] || '').toUpperCase().trim()).filter(Boolean))
        console.log(`Grounded names for sectors: ${groundedNames.size} projects`)
      } catch { /* proceed without grounding */ }
    }

    const preExtractedSections = needsSections
      ? await buildSectionContent(prompt, groundedNames)
      : {}

    console.log(`Generate: ${chunks.length} chunks + ${summaryContext.length} summary chars`)
    const sectionCount = Object.keys(preExtractedSections).length
    console.log(`Pre-extracted: ${preExtractedRows ? JSON.parse(preExtractedRows).length + ' table rows' : 'no table'} | ${sectionCount} section tables`)

    const chunkContext = chunks.map((c: any, i: number) =>
      `[Source ${i+1}: ${c.source_file} | p${c.page_number}]\n${(c.parent_text || c.chunk_text).slice(0, 800)}`
    ).join('\n\n')

    const context = summaryContext && chunkContext
      ? `## Pre-computed Project & Domain Summaries\n\n${summaryContext}\n\n---\n\n## Specific Source Excerpts\n\n${chunkContext}`
      : summaryContext || chunkContext || 'No relevant information found.'

    const preBuilt: string[] = []
    if (preExtractedRows) preBuilt.push(`## Pre-extracted Table Rows (use ALL of these — do not modify)\n\nJSON rows: ${preExtractedRows}`)
    if (partnerContext)   preBuilt.push(partnerContext)
    const enrichedContext = preBuilt.length > 0
      ? preBuilt.join('\n\n---\n\n') + '\n\n---\n\n' + context
      : context

    let structure = decodeStructure(await generateStructure(prompt, enrichedContext, outputType, needsTable))

    // Enforce layout diversity for PPTX — retry once if monotonous
    if (outputType === 'pptx') {
      const diversity = checkLayoutDiversity(structure)
      if (!diversity.ok) {
        console.warn(`[generate] layout diversity rejected: ${diversity.reason} — re-prompting once`)
        const retryHint = `Your previous attempt failed the layout diversity check (${diversity.reason}). REDO the deck using AT LEAST 3 distinct layout types and AT MOST 60% title_content. You MUST include at least one big_stat, one section_break, and one two_column or table_slide or chart_slide.`
        structure = decodeStructure(await generateStructure(prompt + '\n\n' + retryHint, enrichedContext, outputType, needsTable))
        const diversity2 = checkLayoutDiversity(structure)
        if (!diversity2.ok) console.warn(`[generate] layout diversity still bad after retry: ${diversity2.reason} — accepting`)
      }
    }

    // Inject pre-extracted rows directly into structure — bypasses GPT truncation
    if (preExtractedRows) {
      try {
        const allRows: string[][] = JSON.parse(preExtractedRows)
        if (allRows.length > 0) {
          if (outputType === 'docx') {
            const tableSection = structure.sections?.find((s: any) => s.table)
            if (tableSection) {
              tableSection.table.rows = allRows
              console.log(`Injected ${allRows.length} rows into docx table`)
            }
          } else if (outputType === 'pptx') {
            const tableSlide = structure.slides?.find((s: any) => s.layout === 'table_slide')
            if (tableSlide) {
              if (!tableSlide.table) tableSlide.table = { headers: ['Project', 'Technologies Developed', 'Parameters Monitored', 'Results Obtained'], rows: [] }
              tableSlide.table.rows = allRows
            } else {
              const insertAt = Math.max(1, (structure.slides || []).findIndex((s: any) => s.layout === 'section_break') + 1)
              structure.slides = structure.slides || []
              structure.slides.splice(insertAt, 0, {
                layout: 'table_slide',
                title: 'Technologies Developed by IRIS',
                table: { headers: ['Project', 'Technologies Developed', 'Parameters Monitored', 'Results Obtained'], rows: allRows }
              })
            }
            console.log(`Injected ${allRows.length} rows into pptx table_slide`)
          }
        }
      } catch { /* keep GPT table if parse fails */ }
    }

    // Inject pre-extracted section tables directly — bypasses GPT interpretation
    if (sectionCount > 0) {
      try {
        if (outputType === 'docx') {
          if (preExtractedSections.sectorsTable) {
            structure.sections = (structure.sections || []).filter((s: any) => !/sector|application|industr/i.test(s.heading))
            structure.sections.push({ heading: 'Sectors and Applications', level: 1, body: '', table: preExtractedSections.sectorsTable })
            console.log(`Injected sectors table: ${preExtractedSections.sectorsTable.rows.length} rows`)
          }
          if (preExtractedSections.rolesTable) {
            structure.sections = (structure.sections || []).filter((s: any) => !/role|non.?technical|management|coordinator/i.test(s.heading))
            structure.sections.push({ heading: 'Non-Technical Roles', level: 1, body: '', table: preExtractedSections.rolesTable })
            console.log(`Injected roles table: ${preExtractedSections.rolesTable.rows.length} rows`)
          }
        } else if (outputType === 'pptx') {
          structure.slides = structure.slides || []
          if (preExtractedSections.sectorsTable) {
            structure.slides = structure.slides.filter((s: any) => !/sector|application|industr/i.test(s.title || ''))
            structure.slides.push({ layout: 'table_slide', title: 'Sectors and Applications', table: preExtractedSections.sectorsTable })
            console.log(`Injected pptx sectors table: ${preExtractedSections.sectorsTable.rows.length} rows`)
          }
          if (preExtractedSections.rolesTable) {
            structure.slides = structure.slides.filter((s: any) => !/role|non.?technical|management|coordinator/i.test(s.title || ''))
            structure.slides.push({ layout: 'table_slide', title: 'IRIS Non-Technical Roles', table: preExtractedSections.rolesTable })
            console.log(`Injected pptx roles table: ${preExtractedSections.rolesTable.rows.length} rows`)
          }
        }
      } catch (e: any) { console.error('Section injection error:', e.message) }
    }

    // Deduplicate sections — if two sections match same heading regex, keep the one with a table
    if (structure.sections) {
      const SECTOR_RE = /sector|application|industr/i
      const ROLES_RE  = /role|non.?technical|management|coordinator/i
      for (const re of [SECTOR_RE, ROLES_RE]) {
        const matches = structure.sections.filter((s: any) => re.test(s.heading))
        if (matches.length > 1) {
          const withTable = matches.find((s: any) => s.table)
          const toRemove  = matches.filter((s: any) => s !== withTable)
          structure.sections = structure.sections.filter((s: any) => !toRemove.includes(s))
          console.log(`Deduplicated ${toRemove.length} prose section(s) for ${re}`)
        }
      }
    }

    // Inject real project references from grounded names
    if (groundedNames && groundedNames.size > 0 && structure.references) {
      structure.references = [...groundedNames].sort()
      console.log(`Injected ${structure.references.length} project references`)
    }

    // Validate chart_slide unit homogeneity — replace with table_slide if values span >100× range or contain NaN
    if (outputType === 'pptx' && structure.slides) {
      for (const slide of structure.slides) {
        if (slide.layout !== 'chart_slide') continue
        const values: number[] = (slide.values || []).map(Number)
        const hasNaN = values.some(isNaN)
        const nonZero = values.filter((v: number) => v !== 0 && isFinite(v))
        const mixed = nonZero.length > 1 && (Math.max(...nonZero) / Math.min(...nonZero)) > 100
        if (hasNaN || mixed) {
          slide.layout = 'table_slide'
          slide.table = {
            headers: ['Metric', 'Value'],
            rows: (slide.labels || []).map((l: string, i: number) => [l, String(slide.values?.[i] ?? '')])
          }
          console.log(`Replaced mixed-unit chart_slide "${slide.title}" with table_slide`)
        }
      }
    }

    // Coverage check — log any project mentioned in overview bullets that lacks an outcomes slide
    if (outputType === 'pptx' && structure.slides) {
      const overviewSlide = structure.slides.find((s: any) => /overview|all projects|portfolio/i.test(s.title || ''))
      if (overviewSlide) {
        const overviewText = [...(overviewSlide.bullets || []), ...(overviewSlide.left || []), ...(overviewSlide.right || [])].join(' ')
        const outcomeTitles = structure.slides.filter((s: any) => /outcome|result|key finding/i.test(s.title || '')).map((s: any) => (s.title || '').toLowerCase())
        const projectMentions = (overviewText.match(/\b[A-Z]{3,12}\b/g) || []).filter((w: string) => !/IRIS|NIR|TRL|PPT|PDF|CSA|RIA|SME|EU|WP/i.test(w))
        const missing = projectMentions.filter((p: string) => !outcomeTitles.some((t: string) => t.includes(p.toLowerCase())))
        if (missing.length) console.log(`Coverage: overview projects without outcomes slides: ${[...new Set(missing)].join(', ')}`)
      }
    }

    // Strip internal pipeline tokens from chunk source_file before rendering
    for (const c of chunks) {
      if (c.source_file) c.source_file = cleanSourceFile(c.source_file)
    }

    let buffer: Buffer
    let contentType: string
    let ext: string

    if (outputType === 'pptx') {
      buffer = await buildPptx(structure, chunks)
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ext = 'pptx'
    } else {
      buffer = await buildDocx(structure, chunks)
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ext = 'docx'
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="IRIS_Report.${ext}"`
      }
    })

  } catch (e: any) {
    console.error('GENERATE ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
