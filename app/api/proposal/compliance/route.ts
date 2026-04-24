/**
 * IRIS KB — Compliance Checker
 *
 * POST { sections, brief, callText, template }
 *   → { passed, warnings, failed, pageCount }
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ProjectBrief, ComplianceResult, CheckResult } from '@/lib/proposal-types'
import type { ProposalTemplate } from '@/lib/proposal-templates'
import { supabase } from '@/lib/iris-kb'

// ─── REQUIREMENT EXTRACTION ───────────────────────────────────────────────────

interface CallRequirement {
  id: string
  text: string
  mandatory: boolean
  checkPattern: string
}

function extractRequirements(
  callText: string,
  brief: ProjectBrief,
  template: ProposalTemplate
): CallRequirement[] {
  const reqs: CallRequirement[] = []
  const text = callText.toLowerCase()

  // ── TRL journey ──────────────────────────────────────────────────────────
  reqs.push({
    id: 'trl_start',
    text: `TRL start level (${brief.trlStart}) mentioned`,
    mandatory: true,
    checkPattern: `trl ${brief.trlStart}|trl${brief.trlStart}|technology readiness level ${brief.trlStart}`,
  })
  reqs.push({
    id: 'trl_end',
    text: `TRL end level (${brief.trlEnd}) mentioned`,
    mandatory: true,
    checkPattern: `trl ${brief.trlEnd}|trl${brief.trlEnd}|technology readiness level ${brief.trlEnd}`,
  })

  // ── Stage 1 blind evaluation ──────────────────────────────────────────────
  if (brief.stage === 'stage1') {
    reqs.push({
      id: 'blind_eval',
      text: 'No organisation names in abstract/excellence section (blind evaluation)',
      mandatory: true,
      checkPattern: '_BLIND_CHECK_',
    })
  }

  // ── Gender dimension ─────────────────────────────────────────────────────
  reqs.push({
    id: 'gender',
    text: 'Gender dimension addressed',
    mandatory: false,
    checkPattern: 'gender|gender dimension|sex-disaggregated|gender-sensitive',
  })

  // ── Ethics ───────────────────────────────────────────────────────────────
  if (text.includes('ethical') || text.includes('ethics')) {
    reqs.push({
      id: 'ethics',
      text: 'Ethics considerations addressed',
      mandatory: true,
      checkPattern: 'ethics|ethical|gdpr|data protection|privacy',
    })
  }

  // ── Open access ───────────────────────────────────────────────────────────
  reqs.push({
    id: 'open_access',
    text: 'Open access / open science plan mentioned',
    mandatory: false,
    checkPattern: 'open access|open science|openaire|zenodo|data management plan|dmp',
  })

  // ── Required partnerships ────────────────────────────────────────────────
  const partnershipKeywords: Array<{ id: string; label: string; pattern: string }> = [
    { id: 'processes4planet', label: 'Processes4Planet partnership', pattern: 'processes4planet|processes 4 planet' },
    { id: 'ai_data_robotics', label: 'AI, Data & Robotics partnership', pattern: 'ai, data and robotics|ai data and robotics|ai, data & robotics|adra' },
    { id: 'clean_steel', label: 'Clean Steel partnership', pattern: 'clean steel|cleansteel' },
    { id: 'battery2030', label: 'Battery2030+ partnership', pattern: 'battery2030|battery 2030' },
  ]

  for (const kw of partnershipKeywords) {
    if (text.includes(kw.pattern.split('|')[0])) {
      reqs.push({
        id: kw.id,
        text: `${kw.label} mentioned`,
        mandatory: false,
        checkPattern: kw.pattern,
      })
    }
  }

  // ── Business case ────────────────────────────────────────────────────────
  if (template.sections.some(s => s.id === 'business_case')) {
    reqs.push({
      id: 'business_case_present',
      text: 'Business case section written',
      mandatory: true,
      checkPattern: '_SECTION_business_case_',
    })
  }

  // ── Extract expected outcomes from call text ──────────────────────────────
  const outcomeMatches = callText.match(/expected outcomes?[:\s]+([^\n.]{20,200})/gi) || []
  outcomeMatches.slice(0, 5).forEach((match, i) => {
    const outcomeText = match.replace(/expected outcomes?[:\s]+/i, '').trim()
    const keywords = outcomeText
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 4)
      .join('|')
    if (keywords) {
      reqs.push({
        id: `outcome_${i}`,
        text: `Expected outcome addressed: "${outcomeText.slice(0, 80)}..."`,
        mandatory: false,
        checkPattern: keywords,
      })
    }
  })

  return reqs
}

// ─── COMPLIANCE CHECK ─────────────────────────────────────────────────────────

function checkCompliance(
  sections: Record<string, string>,
  brief: ProjectBrief,
  requirements: CallRequirement[],
  template: ProposalTemplate
): ComplianceResult {
  const allText = Object.values(sections).join(' ')
  const result: ComplianceResult = { passed: [], warnings: [], failed: [], pageCount: {} }

  for (const req of requirements) {
    let found = false

    if (req.checkPattern === '_BLIND_CHECK_') {
      // Check no org names appear in the excellence/abstract section for stage1
      const excellenceText = (sections['excellence'] || sections['objectives'] || '').toLowerCase()
      const orgNames = brief.partners.map(p => p.name.toLowerCase())
      found = !orgNames.some(name => name.length > 3 && excellenceText.includes(name))
    } else if (req.checkPattern.startsWith('_SECTION_')) {
      const sectionId = req.checkPattern.replace('_SECTION_', '').replace('_', '')
      found = !!(sections[sectionId]?.trim())
    } else {
      found = req.checkPattern
        .split('|')
        .some(pattern => allText.toLowerCase().includes(pattern.toLowerCase().trim()))
    }

    const item: CheckResult = { id: req.id, text: req.text }
    if (found) {
      result.passed.push(item)
    } else if (req.mandatory) {
      result.failed.push(item)
    } else {
      result.warnings.push(item)
    }
  }

  // ── Page count checks ───────────────────────────────────────────────────
  for (const section of template.sections) {
    const text = sections[section.id] || ''
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const estimatedPages = wordCount / 400
    result.pageCount[section.id] = Math.round(estimatedPages * 10) / 10

    if (text && estimatedPages < section.pages * 0.7) {
      result.warnings.push({
        id: `length_${section.id}`,
        text: `${section.title} is short: ~${estimatedPages.toFixed(1)} pages vs ${section.pages} target`,
      })
    }
    if (estimatedPages > section.pages * 1.15) {
      result.warnings.push({
        id: `overlength_${section.id}`,
        text: `${section.title} may be over page limit: ~${estimatedPages.toFixed(1)} pages vs ${section.pages} target`,
      })
    }
  }

  return result
}

// ─── TECHNOLOGY MATCH HELPER ──────────────────────────────────────────────────

function techMatches(canonical: string, claimed: string): boolean {
  const words = canonical.toLowerCase().split(/[\s,\/]+/).filter(w => w.length > 4)
  const c = claimed.toLowerCase()
  return words.some(w => c.includes(w))
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sections, brief, callText, template }: {
      sections: Record<string, string>
      brief: ProjectBrief
      callText: string
      template: ProposalTemplate
    } = body

    if (!sections || !brief || !callText || !template) {
      return NextResponse.json({ error: 'sections, brief, callText, and template are required' }, { status: 400 })
    }

    const requirements = extractRequirements(callText, brief, template)
    const result = checkCompliance(sections, brief, requirements, template)

    // ── KG technology validation ─────────────────────────────────────────────
    const { data: kgTechs } = await supabase
      .from('kg_technologies')
      .select('name')
      // no filter — check all technologies, not just iris_developed

    if (kgTechs && kgTechs.length > 0) {
      const canonicalNames: string[] = kgTechs.map((t: { name: string }) => t.name)

      // 1. Check each claimed technology against canonical names
      if (brief.irisTechnologies && brief.irisTechnologies.length > 0) {
        for (const claimed of brief.irisTechnologies) {
          const matched = canonicalNames.some(canonical => techMatches(canonical, claimed))
          if (!matched) {
            result.warnings.push({
              id: `tech_unrecognised_${claimed.slice(0, 20).replace(/\s+/g, '_')}`,
              text: `Technology "${claimed}" not found in IRIS canonical technology list — verify spelling or add to knowledge base`,
            })
          }
        }
      }

      // 2. Scan proposal text for iris_developed technologies not declared in brief
      const { data: irisDeveloped } = await supabase
        .from('kg_project_technologies')
        .select('technology_name')
        .eq('iris_developed', true)

      if (irisDeveloped && irisDeveloped.length > 0) {
        const allText = Object.values(sections).join(' ')
        const declaredLower = (brief.irisTechnologies ?? []).map(t => t.toLowerCase())
        const seenIds = new Set<string>()

        for (const row of irisDeveloped as Array<{ technology_name: string }>) {
          const techName = row.technology_name
          const techId = techName.toLowerCase()
          if (seenIds.has(techId)) continue

          // Check if mentioned in proposal text
          const words = techName.toLowerCase().split(/[\s,\/]+/).filter(w => w.length > 4)
          const mentionedInText = words.length > 0 && words.some(w => allText.toLowerCase().includes(w))

          if (mentionedInText) {
            // Check if already declared in brief
            const declaredInBrief = declaredLower.some(d => techMatches(techName, d))
            if (!declaredInBrief) {
              seenIds.add(techId)
              result.warnings.push({
                id: `tech_undeclared_${techId.slice(0, 20).replace(/\s+/g, '_')}`,
                text: `Technology mentioned in text but not declared in brief: ${techName}`,
              })
            }
          }
        }
      }
    }

    console.log(`Compliance: ${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failed.length} failed`)

    return NextResponse.json(result)

  } catch (e: any) {
    console.error('Compliance route error:', e)
    return NextResponse.json({ error: e.message || 'Compliance check failed' }, { status: 500 })
  }
}
