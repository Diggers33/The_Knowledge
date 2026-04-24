/**
 * IRIS KB — Consortium Builder
 *
 * POST { brief, rolesNeeded }
 *   → { suggestions, geographicGaps, profileWarnings }
 *
 * Three sources (run in parallel):
 *   1. IRIS KB — project_summaries partners dimension → gpt-4o-mini extraction
 *   2. Tavily web search → gpt-4o-mini extraction
 *   3. Static high-quality fallback list (always non-empty)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/iris-kb'
import type { ProjectBrief, PartnerSuggestion } from '@/lib/proposal-types'

// ─── SOURCE 1: IRIS GRAPH PARTNER HISTORY ────────────────────────────────────
// Queries kg_partners + kg_project_partners + kg_projects/domains directly —
// 883 canonical partners across 1,356 project edges.

async function getKBPartners(
  topicKeywords: string,
  rolesNeeded: string[]
): Promise<PartnerSuggestion[]> {
  const kwds = topicKeywords
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 8)

  // Find topic-relevant project IDs via domain tags and project full_name
  let relevantProjectIds: string[] = []
  if (kwds.length > 0) {
    const domainFilter    = kwds.map(kw => `domain.ilike.%${kw}%`).join(',')
    const fullNameFilter  = kwds.map(kw => `full_name.ilike.%${kw}%`).join(',')
    const [{ data: domainMatches }, { data: nameMatches }] = await Promise.all([
      supabase.from('kg_project_domains').select('project_id').or(domainFilter).limit(50),
      supabase.from('kg_projects').select('id').or(fullNameFilter).limit(50),
    ])
    relevantProjectIds = [
      ...new Set([
        ...(domainMatches || []).map((r: any) => r.project_id),
        ...(nameMatches  || []).map((r: any) => r.id),
      ])
    ]
  }

  // Fetch edges for relevant projects; fall back to all edges if no match
  const edgeQuery = relevantProjectIds.length > 0
    ? supabase.from('kg_project_partners').select('partner_id, role, project_id').in('project_id', relevantProjectIds)
    : supabase.from('kg_project_partners').select('partner_id, role, project_id').limit(600)

  const { data: edges } = await edgeQuery
  if (!edges?.length) return []

  const partnerIds = [...new Set(edges.map((e: any) => e.partner_id))]
  const projectIds = [...new Set(edges.map((e: any) => e.project_id))]

  const [{ data: partners }, { data: projects }] = await Promise.all([
    supabase.from('kg_partners').select('id, canonical_name, country_code, partner_type').in('id', partnerIds),
    supabase.from('kg_projects').select('id, project_code').in('id', projectIds),
  ])

  const partnerMap = new Map((partners || []).map((p: any) => [p.id, p]))
  const projMap    = new Map((projects  || []).map((p: any) => [p.id, p.project_code]))

  // Aggregate per partner: collect distinct roles and project codes
  const agg = new Map<string, { partner: any; roles: Set<string>; projCodes: Set<string> }>()
  for (const edge of edges) {
    const p = partnerMap.get(edge.partner_id)
    if (!p) continue
    if (!agg.has(p.id)) agg.set(p.id, { partner: p, roles: new Set(), projCodes: new Set() })
    const entry = agg.get(p.id)!
    if (edge.role) entry.roles.add(edge.role)
    const code = projMap.get(edge.project_id)
    if (code) entry.projCodes.add(code)
  }

  const partnerRows = [...agg.values()]
    .map(({ partner, roles, projCodes }) => ({
      name:   partner.canonical_name,
      country: partner.country_code || '',
      type:   partner.partner_type  || '',
      roles:  [...roles].join(', '),
      projects: [...projCodes].join(', '),
      count:  projCodes.size,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 120)

  if (partnerRows.length === 0) return []

  const listText = partnerRows
    .map(p => `${p.name} | ${p.country} | ${p.type} | ${p.projects}`)
    .join('\n')

  const prompt = `You are reviewing IRIS Technology Solutions' verified consortium partner history (${partnerRows.length} real organisations from the IRIS project database).
Select organisations relevant for a new proposal on: ${topicKeywords}
Roles needed: ${rolesNeeded.join(', ')}

Partner database (name | country | type | IRIS projects they appeared in):
${listText.slice(0, 5500)}

Return a JSON array of up to 10 relevant organisations. Prioritise partners who appeared in multiple projects and match the proposal topic.
[{
  "name": "exact name from the list above",
  "acronym": "SHORT",
  "country": "XX",
  "type": "university|research_institute|sme|large_company|end_user|association",
  "speciality": "What they do relevant to this proposal",
  "role": "Which needed role they fill",
  "previousWork": "Which IRIS project(s) they appeared in",
  "fitScore": 3,
  "fitReason": "Why they are a good fit"
}]
Only include organisations listed above. Return ONLY valid JSON, no other text.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 1500 }),
    })
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({ ...p, fitScore: Math.max(1, p.fitScore || 1), source: 'kb' as const }))
  } catch (e) {
    console.error('Graph partner extraction error:', e)
    return []
  }
}

// ─── SOURCE 2: TAVILY WEB SEARCH ──────────────────────────────────────────────

async function getTavilyPartners(
  topicKeywords: string,
  rolesNeeded: string[]
): Promise<PartnerSuggestion[]> {
  const TAVILY_KEY = process.env.TAVILY_API_KEY
  if (!TAVILY_KEY) return []

  async function tavilySearch(query: string): Promise<string> {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: false,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      return (data.results || [])
        .map((r: any) => `${r.title}: ${r.snippet || r.content || ''}`)
        .join('\n')
    } catch {
      return ''
    }
  }

  const [researchResults, industryResults, endUserResults] = await Promise.all([
    tavilySearch(`Horizon Europe research institute ${topicKeywords} AI process industry consortium partner`),
    tavilySearch(`SME company ${topicKeywords} AI manufacturing technology EU Horizon Europe`),
    tavilySearch(`${topicKeywords} process industry end user pilot demonstration Horizon Europe project`),
  ])

  const combinedResults = [
    researchResults && `[Research organisations]:\n${researchResults}`,
    industryResults && `[Industry/SME partners]:\n${industryResults}`,
    endUserResults  && `[End users]:\n${endUserResults}`,
  ].filter(Boolean).join('\n\n')

  if (!combinedResults) return []

  const prompt = `Extract consortium partner organisations from this web search data for a Horizon Europe proposal on: ${topicKeywords}
Roles needed: ${rolesNeeded.join(', ')}

Search results:
${combinedResults.slice(0, 4000)}

Return a JSON array of up to 8 relevant organisations:
[{
  "name": "Organisation full name",
  "acronym": "SHORT",
  "country": "XX",
  "type": "university|research_institute|sme|large_company|end_user|association",
  "speciality": "What they do relevant to the topic",
  "role": "Which needed role they fill",
  "fitScore": 2,
  "fitReason": "Why they are a good fit"
}]
Only include organisations explicitly named in the search results.
Return ONLY valid JSON, no other text.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1500,
      }),
    })
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({ ...p, fitScore: Math.max(1, p.fitScore || 1), source: 'openaire' as const }))
  } catch (e) {
    console.error('Tavily partner extraction error:', e)
    return []
  }
}

// ─── SOURCE 3: STATIC HIGH-QUALITY FALLBACK ───────────────────────────────────

interface StaticPartner {
  name: string
  acronym: string
  country: string
  type: string
  speciality: string
  fitReason: string
  keywords: string[]
}

const STATIC_PARTNERS: Record<string, StaticPartner[]> = {
  'AI/ML Research Institute': [
    { name: 'Fraunhofer IPA',              acronym: 'Fraunhofer',      country: 'DE', type: 'research_institute', speciality: 'AI for manufacturing and process automation',       fitReason: 'Leading HE partner in AI + manufacturing, strong track record in RIA projects',                     keywords: ['ai', 'manufacturing', 'process', 'automation', 'industry', 'robot'] },
    { name: 'TNO',                         acronym: 'TNO',             country: 'NL', type: 'research_institute', speciality: 'Industrial AI and digital twins',                   fitReason: 'Major EU applied research institute, strong in process industry digitalisation',                     keywords: ['ai', 'digital', 'process', 'industry', 'sensing', 'iot'] },
    { name: 'SINTEF',                      acronym: 'SINTEF',          country: 'NO', type: 'research_institute', speciality: 'AI for process industries and sustainability',       fitReason: 'Strong track record in Processes4Planet and industrial AI projects',                               keywords: ['process', 'industry', 'sustainability', 'ai', 'chemical', 'energy'] },
    { name: 'Tecnalia',                    acronym: 'TECNALIA',        country: 'ES', type: 'research_institute', speciality: 'Smart manufacturing and AI',                        fitReason: 'Leading Spanish RTO, frequent partner in manufacturing and digitisation projects',                  keywords: ['manufacturing', 'smart', 'ai', 'digital', 'industry', 'sensor'] },
    { name: 'CSIC',                        acronym: 'CSIC',            country: 'ES', type: 'research_institute', speciality: 'AI, sensing and analytical technologies',           fitReason: 'Spanish national research council, broad technical expertise, same country as IRIS',                keywords: ['ai', 'sensing', 'analytical', 'spectroscop', 'chemistry', 'material'] },
    { name: 'VTT Technical Research Centre', acronym: 'VTT',           country: 'FI', type: 'research_institute', speciality: 'Industrial AI and process analytics',               fitReason: 'Finnish national RTO, strong in industrial digitalisation and process AI',                         keywords: ['process', 'ai', 'industrial', 'analytics', 'digital', 'manufacturing'] },
    { name: 'CERTH',                       acronym: 'CERTH',           country: 'GR', type: 'research_institute', speciality: 'AI, machine learning and process monitoring',       fitReason: 'Greek research centre, frequent partner in Horizon Europe AI projects',                            keywords: ['ai', 'machine learning', 'monitoring', 'process', 'sensing'] },
  ],
  'Process Industry End User': [
    { name: 'HeidelbergMaterials',         acronym: 'HM',              country: 'DE', type: 'end_user',           speciality: 'Cement and building materials manufacturing',        fitReason: 'Major process industry company with active decarbonisation and AI programmes',                      keywords: ['cement', 'material', 'manufacturing', 'process', 'emission', 'sustainability'] },
    { name: 'Solvay',                      acronym: 'SOLVAY',          country: 'BE', type: 'end_user',           speciality: 'Specialty chemicals manufacturing',                  fitReason: 'Processes4Planet partner, active in AI adoption for chemical processes',                           keywords: ['chemical', 'process', 'sustainability', 'manufacturing', 'material'] },
    { name: 'Covestro',                    acronym: 'COVESTRO',        country: 'DE', type: 'end_user',           speciality: 'Polymer and plastics manufacturing',                 fitReason: 'Sustainability-driven large company, AI process optimisation programmes',                           keywords: ['polymer', 'plastic', 'chemical', 'manufacturing', 'sustainability', 'circular'] },
    { name: 'Arkema',                      acronym: 'ARKEMA',          country: 'FR', type: 'end_user',           speciality: 'Specialty materials and chemicals',                  fitReason: 'Active in HE AI for process industry calls, French geographic coverage',                           keywords: ['chemical', 'material', 'specialty', 'manufacturing', 'process'] },
    { name: 'Nestlé',                      acronym: 'NESTLE',          country: 'CH', type: 'end_user',           speciality: 'Food and beverage manufacturing',                    fitReason: 'Global food manufacturer, existing IRIS client, PAT and quality control focus',                    keywords: ['food', 'beverage', 'manufacturing', 'quality', 'pat', 'process'] },
    { name: 'AstraZeneca',                 acronym: 'AZ',              country: 'SE', type: 'end_user',           speciality: 'Pharmaceutical manufacturing',                       fitReason: 'Existing IRIS client, strong in PAT and continuous manufacturing',                                 keywords: ['pharma', 'pharmaceutical', 'manufacturing', 'pat', 'quality', 'process'] },
  ],
  'Industrial Automation / OT-IT Integration': [
    { name: 'Aquiles Solutions',           acronym: 'AQUILES',         country: 'ES', type: 'sme',                speciality: 'AI for industrial process optimisation',             fitReason: 'Already a partner in RIVER project with IRIS — proven collaboration',                              keywords: ['ai', 'process', 'industry', 'optimisation', 'manufacturing', 'digital'] },
    { name: 'Engineering Ingegneria Informatica', acronym: 'ENG',      country: 'IT', type: 'large_company',      speciality: 'Digital transformation and IT integration',          fitReason: 'Major Italian IT company, frequent HE partner, OT/IT integration expertise',                       keywords: ['digital', 'it', 'integration', 'manufacturing', 'process', 'platform'] },
    { name: 'Inria',                       acronym: 'INRIA',           country: 'FR', type: 'research_institute', speciality: 'AI systems and software engineering',                fitReason: 'French national computer science institute, AI systems architecture expertise',                      keywords: ['ai', 'software', 'system', 'digital', 'algorithm', 'data'] },
    { name: 'DFKI',                        acronym: 'DFKI',            country: 'DE', type: 'research_institute', speciality: 'AI and intelligent systems for industry',            fitReason: 'German AI research institute, strong in industrial AI applications',                               keywords: ['ai', 'intelligent', 'industry', 'manufacturing', 'robot', 'automation'] },
  ],
  'Sustainability / LCA': [
    { name: 'VITO',                        acronym: 'VITO',            country: 'BE', type: 'research_institute', speciality: 'Life cycle assessment and sustainability',            fitReason: 'Leading European LCA institute, strong in industrial sustainability assessments',                   keywords: ['sustainability', 'lca', 'environment', 'circular', 'emission', 'energy'] },
    { name: 'Quantis',                     acronym: 'QUANTIS',         country: 'FR', type: 'sme',                speciality: 'LCA and environmental impact assessment',            fitReason: 'Specialised sustainability consultancy, HE active',                                                keywords: ['sustainability', 'lca', 'environment', 'impact', 'carbon', 'emission'] },
    { name: 'Fraunhofer IBP',              acronym: 'Fraunhofer-IBP',  country: 'DE', type: 'research_institute', speciality: 'Environmental and sustainability assessment',         fitReason: 'Fraunhofer sustainability institute, LCA and circular economy expertise',                           keywords: ['sustainability', 'environment', 'circular', 'energy', 'emission', 'lca'] },
  ],
  'Dissemination / Standardisation': [
    { name: 'SPIRE',                       acronym: 'SPIRE',           country: 'BE', type: 'association',         speciality: 'Process industries association — Processes4Planet', fitReason: 'Direct link to Processes4Planet partnership, process industry dissemination network',               keywords: ['process', 'industry', 'chemical', 'sustainability', 'manufacturing'] },
    { name: 'EFFRA',                       acronym: 'EFFRA',           country: 'BE', type: 'association',         speciality: 'Manufacturing research association',                 fitReason: 'Factories of the Future association, manufacturing sector dissemination',                           keywords: ['manufacturing', 'factory', 'industry', 'digital', 'robot', 'automation'] },
    { name: 'DIGITALEUROPE',               acronym: 'DIGITALEUROPE',   country: 'BE', type: 'association',         speciality: 'Digital technology industry association',            fitReason: 'European digital industry association, AI policy and standardisation',                             keywords: ['digital', 'ai', 'data', 'technology', 'standard', 'policy'] },
  ],
}

function getStaticSuggestions(
  topicKeywords: string,
  rolesNeeded: string[]
): Record<string, PartnerSuggestion[]> {
  const keywords = topicKeywords.toLowerCase().split(/\s+/)
  const result: Record<string, PartnerSuggestion[]> = {}

  for (const role of rolesNeeded) {
    // Match role to the closest static role key
    const roleKey = Object.keys(STATIC_PARTNERS).find(k =>
      k.toLowerCase().includes(role.toLowerCase().split(' ')[0]) ||
      role.toLowerCase().includes(k.toLowerCase().split(' ')[0])
    ) || Object.keys(STATIC_PARTNERS)[0]

    const candidates = STATIC_PARTNERS[roleKey] || []

    const scored = candidates.map(p => ({
      ...p,
      score: p.keywords.filter(kw => keywords.some(k => k.includes(kw) || kw.includes(k))).length,
    }))
    scored.sort((a, b) => b.score - a.score)

    result[role] = scored.slice(0, 4).map(p => ({
      name:        p.name,
      acronym:     p.acronym,
      country:     p.country,
      type:        p.type as PartnerSuggestion['type'],
      speciality:  p.speciality,
      fitScore:    Math.max(1, p.score >= 3 ? 3 : p.score >= 1 ? 2 : 1),
      fitReason:   p.fitReason,
      source:      'openaire' as const,
    }))
  }

  return result
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { brief, rolesNeeded }: { brief: ProjectBrief; rolesNeeded: string[] } = body

    if (!brief) {
      return NextResponse.json({ error: 'brief is required' }, { status: 400 })
    }

    const topicKeywords = [
      brief.coreInnovation || '',
      brief.scopeSelected  || '',
      (brief.irisTechnologies || []).join(' '),
    ].join(' ').slice(0, 200)

    const roles: string[] = rolesNeeded?.length ? rolesNeeded : [
      'AI/ML Research Institute',
      'Process Industry End User',
      'Industrial Automation / OT-IT Integration',
      'Sustainability / LCA',
      'Dissemination / Standardisation',
    ]

    console.log(`Consortium builder: topic="${topicKeywords.slice(0, 80)}", roles=${roles.length}`)

    // Run dynamic sources in parallel; static is synchronous
    const [kbPartners, webPartners] = await Promise.all([
      getKBPartners(topicKeywords, roles),
      getTavilyPartners(topicKeywords, roles),
    ])
    const staticSuggestions = getStaticSuggestions(topicKeywords, roles)

    console.log(`Partners found: KB=${kbPartners.length}, Web=${webPartners.length}, Static=${Object.values(staticSuggestions).flat().length}`)

    const allDynamic = [...kbPartners, ...webPartners]

    // Group by role, merge dynamic + static (deduped)
    const suggestions = roles.map(role => {
      const dynamic = allDynamic
        .filter(p => {
          const pr = ((p as any).role || '').toLowerCase()
          const rl = role.toLowerCase()
          return pr.includes(rl.split(' ')[0]) || rl.includes(pr.split(' ')[0])
        })
        .slice(0, 3)

      const staticForRole = staticSuggestions[role] || []
      const seen = new Set(dynamic.map(p => p.name.toLowerCase()))
      const uniqueStatic = staticForRole.filter(p => !seen.has(p.name.toLowerCase()))

      return {
        role,
        partners: [...dynamic, ...uniqueStatic].slice(0, 5),
      }
    })

    // Geographic gap analysis
    const confirmedCountries = new Set<string>(
      (brief.partners || []).map((p: any) => (p.country || '').toUpperCase()).filter(Boolean)
    )
    confirmedCountries.add('ES') // IRIS is always ES

    const geographicGaps: string[] = []
    if (confirmedCountries.size < 3) {
      geographicGaps.push('Fewer than 3 EU countries represented — add partners from DE, FR, IT, or NL')
    }
    if (!confirmedCountries.has('DE') && !confirmedCountries.has('FR')) {
      geographicGaps.push('Consider adding a German or French partner — evaluators favour major EU country coverage')
    }

    // Profile warnings
    const confirmedTypes = (brief.partners || []).map((p: any) => p.type)
    const profileWarnings: string[] = []
    if (!confirmedTypes.includes('end_user')) {
      profileWarnings.push('No end user in consortium — essential for RIA with TRL 6 demonstration requirement')
    }
    if ((brief.partners || []).length < 4) {
      profileWarnings.push('Fewer than 4 partners — typical competitive RIA has 6-10 partners')
    }
    if (!confirmedTypes.includes('research_institute') && !confirmedTypes.includes('university')) {
      profileWarnings.push('No research organisation — needed for scientific credibility and peer-reviewed outputs')
    }

    return NextResponse.json({ suggestions, geographicGaps, profileWarnings })

  } catch (e: any) {
    console.error('Consortium route error:', e)
    return NextResponse.json({ error: e.message || 'Consortium build failed' }, { status: 500 })
  }
}
