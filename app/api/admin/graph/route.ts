import { NextResponse } from 'next/server'
import { supabase } from '@/lib/iris-kb'

export async function GET() {
  const [
    projectsRes,
    partnersRes,
    technologiesRes,
    irisTechRes,
    domainsRes,
    edgesRes,
    statusRowsRes,
    programmeRowsRes,
    techCategoryRowsRes,
    coordinatorRes,
  ] = await Promise.allSettled([
    supabase.from('kg_projects').select('*', { count: 'exact', head: true }),
    supabase.from('kg_partners').select('*', { count: 'exact', head: true }),
    supabase.from('kg_technologies').select('*', { count: 'exact', head: true }),
    supabase
      .from('kg_project_technologies')
      .select('*', { count: 'exact', head: true })
      .eq('iris_developed', true),
    supabase.from('kg_project_domains').select('*', { count: 'exact', head: true }),
    supabase.from('kg_project_partners').select('*', { count: 'exact', head: true }),
    supabase.from('kg_projects').select('status'),
    supabase.from('kg_projects').select('funding_programme'),
    supabase.from('kg_technologies').select('category'),
    supabase
      .from('kg_projects')
      .select('*', { count: 'exact', head: true })
      .contains('iris_functional_roles', ['coordinator']),
  ])

  // Helper: extract count from a settled result
  function resolveCount(result: PromiseSettledResult<{ count: number | null; error: unknown }>): number {
    if (result.status === 'fulfilled' && result.value.count != null) {
      return result.value.count
    }
    return 0
  }

  // Helper: aggregate an array of row objects by a string field into a Record<string, number>
  function aggregateByField<T extends Record<string, unknown>>(
    result: PromiseSettledResult<{ data: T[] | null; error: unknown }>,
    field: keyof T,
  ): Record<string, number> {
    if (result.status !== 'fulfilled' || !result.value.data) return {}
    const map = new Map<string, number>()
    for (const row of result.value.data) {
      const key = (row[field] as string | null) ?? 'unknown'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Object.fromEntries(map)
  }

  const totals = {
    projects: resolveCount(projectsRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
    partners: resolveCount(partnersRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
    technologies: resolveCount(technologiesRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
    iris_technologies: resolveCount(irisTechRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
    domains: resolveCount(domainsRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
    edges: resolveCount(edgesRes as PromiseSettledResult<{ count: number | null; error: unknown }>),
  }

  const by_status = aggregateByField(
    statusRowsRes as PromiseSettledResult<{ data: { status: string | null }[] | null; error: unknown }>,
    'status',
  )

  const by_programme = aggregateByField(
    programmeRowsRes as PromiseSettledResult<{ data: { funding_programme: string | null }[] | null; error: unknown }>,
    'funding_programme',
  )

  const by_tech_category = aggregateByField(
    techCategoryRowsRes as PromiseSettledResult<{ data: { category: string | null }[] | null; error: unknown }>,
    'category',
  )

  const coordinator_count = resolveCount(
    coordinatorRes as PromiseSettledResult<{ count: number | null; error: unknown }>,
  )

  return NextResponse.json({
    totals,
    by_status,
    by_programme,
    by_tech_category,
    coordinator_count,
  })
}
