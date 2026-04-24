import { NextResponse } from 'next/server'
import { supabase } from '@/lib/iris-kb'

export async function GET() {
  const [
    technologiesRes,
    partnersRes,
    projectsRes,
    domainsRes,
  ] = await Promise.allSettled([
    supabase
      .from('kg_technologies')
      .select('id, name, category, kg_project_technologies(count)'),
    supabase
      .from('kg_partners')
      .select('name, country_code, partner_type, kg_project_partners(count)'),
    supabase
      .from('kg_projects')
      .select('code, full_name, status, funding_programme, iris_functional_roles, trl_start, trl_end, consortium_size'),
    supabase
      .from('kg_project_domains')
      .select('domain'),
  ])

  // Technologies: flatten count and sort descending
  type TechRow = {
    id: string
    name: string
    category: string | null
    kg_project_technologies: { count: number }[] | { count: number } | null
  }

  const technologies: { name: string; category: string | null; project_count: number }[] = []
  if (technologiesRes.status === 'fulfilled' && technologiesRes.value.data) {
    for (const row of technologiesRes.value.data as TechRow[]) {
      const countVal = row.kg_project_technologies
      let project_count = 0
      if (Array.isArray(countVal) && countVal.length > 0) {
        project_count = countVal[0].count ?? 0
      } else if (countVal && !Array.isArray(countVal)) {
        project_count = (countVal as { count: number }).count ?? 0
      }
      technologies.push({ name: row.name, category: row.category, project_count })
    }
    technologies.sort((a, b) => b.project_count - a.project_count)
  }

  // Partners: flatten count, sort descending, take top 50
  type PartnerRow = {
    name: string
    country_code: string | null
    partner_type: string | null
    kg_project_partners: { count: number }[] | { count: number } | null
  }

  const allPartners: { name: string; country: string | null; type: string | null; project_count: number }[] = []
  if (partnersRes.status === 'fulfilled' && partnersRes.value.data) {
    for (const row of partnersRes.value.data as PartnerRow[]) {
      const countVal = row.kg_project_partners
      let project_count = 0
      if (Array.isArray(countVal) && countVal.length > 0) {
        project_count = countVal[0].count ?? 0
      } else if (countVal && !Array.isArray(countVal)) {
        project_count = (countVal as { count: number }).count ?? 0
      }
      allPartners.push({
        name: row.name,
        country: row.country_code,
        type: row.partner_type,
        project_count,
      })
    }
    allPartners.sort((a, b) => b.project_count - a.project_count)
  }
  const top_partners = allPartners.slice(0, 50)

  // Country distribution: aggregate kg_partners by country_code
  const country_distribution: Record<string, number> = {}
  if (partnersRes.status === 'fulfilled' && partnersRes.value.data) {
    for (const row of partnersRes.value.data as PartnerRow[]) {
      const key = row.country_code ?? 'unknown'
      country_distribution[key] = (country_distribution[key] ?? 0) + 1
    }
  }

  // Domain distribution: aggregate kg_project_domains by domain
  const domain_distribution: Record<string, number> = {}
  if (domainsRes.status === 'fulfilled' && domainsRes.value.data) {
    for (const row of domainsRes.value.data as { domain: string | null }[]) {
      const key = row.domain ?? 'unknown'
      domain_distribution[key] = (domain_distribution[key] ?? 0) + 1
    }
  }

  // Projects
  type ProjectRow = {
    code: string
    full_name: string | null
    status: string | null
    funding_programme: string | null
    iris_functional_roles: string[] | null
    trl_start: number | null
    trl_end: number | null
    consortium_size: number | null
  }

  const projects: {
    code: string
    name: string | null
    status: string | null
    programme: string | null
    iris_roles: string[] | null
    trl_start: number | null
    trl_end: number | null
    consortium_size: number | null
  }[] = []

  if (projectsRes.status === 'fulfilled' && projectsRes.value.data) {
    for (const row of projectsRes.value.data as ProjectRow[]) {
      projects.push({
        code: row.code,
        name: row.full_name,
        status: row.status,
        programme: row.funding_programme,
        iris_roles: row.iris_functional_roles,
        trl_start: row.trl_start,
        trl_end: row.trl_end,
        consortium_size: row.consortium_size,
      })
    }
  }

  return NextResponse.json({
    technologies,
    top_partners,
    country_distribution,
    domain_distribution,
    projects,
  })
}
