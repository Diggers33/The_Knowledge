export type ActionType = 'RIA' | 'IA' | 'CSA' | 'EIC' | 'MSCA'
export type Stage = 'stage1' | 'stage2' | 'single'

export interface SectionTemplate {
  id: string
  title: string
  pages: number
  words: number
  mandatory: boolean
  description: string
  evaluationCriteria?: string
}

export interface ProposalTemplate {
  actionType: ActionType
  stage: Stage
  totalPages: number
  sections: SectionTemplate[]
}

// ─── Canonical Part B sections (RIA + IA combined, v3.3 Sep 2023) ─────────────
// Used by both RIA_stage2 and IA_stage2; totalPages = 45 (50 for lump-sum)
const CANONICAL_STAGE2_SECTIONS: SectionTemplate[] = [
  {
    id: 'excellence',
    title: '1. Excellence',
    pages: 14,
    words: 5600,
    mandatory: true,
    description: 'Objectives, ambition and methodology',
    evaluationCriteria: 'Clarity of objectives; soundness of methodology; gender dimension; open science; AI use',
  },
  {
    id: 'objectives',
    title: '1.1 Objectives and ambition',
    pages: 4,
    words: 1600,
    mandatory: true,
    description: 'Project objectives, ambition and how they go beyond the state of the art',
  },
  {
    id: 'methodology',
    title: '1.2 Methodology',
    pages: 10,
    words: 4000,
    mandatory: true,
    description: 'Overall methodology, concepts, models, assumptions; DNSH; AI use; gender dimension; open science; RDM',
  },
  {
    id: 'impact',
    title: '2. Impact',
    pages: 13,
    words: 5200,
    mandatory: true,
    description: 'Pathways to impact, dissemination, exploitation, communication, summary canvas',
    evaluationCriteria: 'Credibility of pathways; scale and significance; measures to maximise impact',
  },
  {
    id: 'pathways',
    title: "2.1 Project's pathways towards impact",
    pages: 6,
    words: 2400,
    mandatory: true,
    description: 'Expected outcomes, scientific/economic/societal impacts, ToC, KPIs, scale and significance',
  },
  {
    id: 'measures',
    title: '2.2 Measures to maximise impact — Dissemination, exploitation and communication',
    pages: 5,
    words: 2000,
    mandatory: true,
    description: 'Dissemination plan, exploitation strategy and KERs, communication activities, business case where relevant',
  },
  {
    id: 'summary',
    title: '2.3 Summary',
    pages: 1,
    words: 250,
    mandatory: true,
    description: 'Impact canvas: specific needs, expected results, target groups, D&E&C activities',
  },
  {
    id: 'implementation',
    title: '3. Quality and efficiency of the implementation',
    pages: 14,
    words: 5600,
    mandatory: true,
    description: 'Work plan, resources, consortium capacity',
    evaluationCriteria: 'Quality and effectiveness of work plan; capacity of participants and consortium',
  },
  {
    id: 'workplan',
    title: '3.1 Work plan and resources',
    pages: 9,
    words: 3600,
    mandatory: true,
    description: 'Work plan narrative, Tables 3.1a–3.1j: WP list, WP descriptions, deliverables, milestones, risks, staff effort, subcontracting, purchase, other costs, in-kind. Project Management is always the final WP.',
  },
  {
    id: 'capacity',
    title: '3.2 Capacity of participants and consortium as a whole',
    pages: 5,
    words: 2000,
    mandatory: true,
    description: 'Consortium composition, complementarity, partner profiles, role of each participant. Must address SSH expertise, open science practices, and gender aspects of R&I.',
  },
]

export const TEMPLATES: Record<string, ProposalTemplate> = {

  'RIA_stage1': {
    actionType: 'RIA',
    stage: 'stage1',
    totalPages: 10,
    sections: [
      {
        id: 'excellence',
        title: '1. Excellence',
        pages: 7,
        words: 2800,
        mandatory: true,
        description: 'Objectives and ambition',
        evaluationCriteria: 'Soundness of concept, quality of objectives, credibility of proposed approach',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives and ambition',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Specific, measurable objectives. Ambition beyond the state of the art.',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Pathways to impact and measures to maximise impact',
        evaluationCriteria: 'Expected outcomes and impacts, quality of measures to maximise impact',
      },
      {
        id: 'pathways',
        title: "2.1 Project's pathways towards impact",
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'How the project contributes to the call expected outcomes. Quantified where possible.',
      },
      {
        id: 'measures',
        title: '2.2 Measures to maximise impact — Dissemination, exploitation and communication',
        pages: 1,
        words: 400,
        mandatory: true,
        description: 'How results will be shared, exploited, and communicated',
      },
    ],
  },

  'RIA_stage2': {
    actionType: 'RIA',
    stage: 'stage2',
    totalPages: 45,
    sections: CANONICAL_STAGE2_SECTIONS,
  },

  'RIA_single': {
    actionType: 'RIA',
    stage: 'single',
    totalPages: 45,
    sections: CANONICAL_STAGE2_SECTIONS,
  },

  'IA_stage2': {
    actionType: 'IA',
    stage: 'stage2',
    totalPages: 45,
    sections: CANONICAL_STAGE2_SECTIONS,
  },

  'IA_single': {
    actionType: 'IA',
    stage: 'single',
    totalPages: 45,
    sections: CANONICAL_STAGE2_SECTIONS,
  },

  'CSA_single': {
    actionType: 'CSA',
    stage: 'single',
    totalPages: 30,
    sections: [
      {
        id: 'excellence',
        title: '1. Excellence',
        pages: 10,
        words: 4000,
        mandatory: true,
        description: 'Objectives, approach, coordination activities',
        evaluationCriteria: 'Quality of objectives, soundness of coordination approach',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'Coordination and support objectives',
      },
      {
        id: 'methodology',
        title: '1.2 Approach and activities',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'Coordination methodology, stakeholder engagement, activities plan',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'Expected outcomes, dissemination, policy impact',
        evaluationCriteria: 'Expected outcomes, dissemination and communication plan',
      },
      {
        id: 'pathways',
        title: "2.1 Project's pathways towards impact",
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Policy impact, community building, standardisation outcomes',
      },
      {
        id: 'measures',
        title: '2.2 Measures to maximise impact — Dissemination, exploitation and communication',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Outreach plan, target audiences, channels',
      },
      {
        id: 'implementation',
        title: '3. Quality and efficiency of the implementation',
        pages: 12,
        words: 4800,
        mandatory: true,
        description: 'Work plan, management, consortium',
        evaluationCriteria: 'Quality and efficiency of implementation',
      },
      {
        id: 'workplan',
        title: '3.1 Work plan and resources',
        pages: 6,
        words: 2400,
        mandatory: true,
        description: 'WPs, tasks, deliverables, Gantt. Project Management is always the final WP.',
      },
      {
        id: 'capacity',
        title: '3.2 Capacity of participants and consortium as a whole',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Partner profiles, roles, geographic spread',
      },
    ],
  },
}

export function detectTemplate(callText: string): ProposalTemplate {
  const text = callText.toLowerCase()

  let actionType: ActionType = 'RIA'
  if (text.includes('coordination and support action') || text.includes('(csa)')) actionType = 'CSA'
  if (/\binnovation action\b/i.test(text) && !/\bresearch and innovation action\b/i.test(text)) actionType = 'IA'
  if (/\(\s*IA\s*\)|\baction\s+type[:\s]+IA\b|-IA-/i.test(text) && actionType !== 'CSA') actionType = 'IA'
  const callIdLine = callText.match(/^Call:\s*(HORIZON[-\s][^\n]+)/im)?.[1]?.toUpperCase() || ''
  if (callIdLine && /-IA-/.test(callIdLine) && actionType !== 'CSA') actionType = 'IA'
  if (text.includes('eic accelerator')) actionType = 'EIC'

  let stage: Stage = 'single'
  if (
    text.includes('two-stage') || text.includes('two stage') ||
    text.includes('first-stage') || text.includes('blind evaluation')
  ) {
    stage = 'stage1'
  }

  const templateKey = `${actionType}_${stage}`
  return TEMPLATES[templateKey] || TEMPLATES['RIA_stage2']
}

// ─── Draft schema migration (v1 → v2) ────────────────────────────────────────
// Maps old section IDs (pre-canonical) to new canonical IDs.
// Returns migrated sections object and schemaVersion: 2.

export function migrateDraftSections(
  oldSections: Record<string, string>
): Record<string, string> {
  const s = { ...oldSections }
  const out: Record<string, string> = {}

  // Pass through sections that exist in both schemas unchanged
  for (const id of ['objectives', 'methodology', 'workplan', 'implementation',
                     'excellence', 'impact', 'pathways', 'measures', 'summary',
                     'capacity']) {
    if (s[id]) out[id] = s[id]
  }

  // sota (old 1.2) → prepend into objectives
  if (s.sota) {
    out.objectives = s.sota + (out.objectives ? '\n\n' + out.objectives : '')
  }

  // innovation (old 1.4) → prepend into objectives as ambition narrative
  if (s.innovation) {
    out.objectives = (out.objectives || '') + (s.innovation ? '\n\n' + s.innovation : '')
  }

  // outcomes (old 2.1) → pathways
  if (s.outcomes && !out.pathways) out.pathways = s.outcomes

  // dissemination (old 2.2) → measures
  if (s.dissemination && !out.measures) out.measures = s.dissemination

  // communication (old 2.3) → append into measures
  if (s.communication) {
    out.measures = (out.measures || '') + (s.communication ? '\n\n' + s.communication : '')
  }

  // business_case → append into measures under exploitation sub-heading
  if (s.business_case) {
    out.measures = (out.measures || '') + '\n\n### Exploitation and business case\n\n' + s.business_case
  }

  // management + consortium → merge into capacity
  const capParts: string[] = []
  if (s.management) capParts.push(s.management)
  if (s.consortium) capParts.push(s.consortium)
  if (capParts.length && !out.capacity) out.capacity = capParts.join('\n\n')

  return out
}
