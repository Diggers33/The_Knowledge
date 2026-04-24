import type { ProposalTemplate } from './proposal-templates'

export type { ProposalTemplate } from './proposal-templates'

export interface Partner {
  id: string
  name: string
  acronym: string
  country: string
  type: 'university' | 'research_institute' | 'sme' | 'large_company' | 'end_user' | 'association'
  role: string
  speciality: string
  wps?: string[]
  previousWork?: string
  source: 'kb' | 'openaire' | 'manual'
}

export interface ProjectBrief {
  // Call info
  callId: string
  callTitle: string
  actionType: string
  stage: 'stage1' | 'stage2' | 'single'
  scopeSelected: string

  // Concept
  projectTitle: string
  acronym: string
  coreInnovation: string
  whyBeyondSotA: string
  competitiveDifferentiator: string

  // Technical
  irisRole: string
  irisWPs: string[]
  irisTechnologies: string[]
  trlStart: number
  trlEnd: number
  pilots: string[]

  // Consortium
  partners: Partner[]

  // Template
  template: ProposalTemplate
}

export interface Concept {
  title: string
  acronym: string
  coreInnovation: string
  whyBeyondSotA: string
  irisRole: string
  irisTechnologies: string[]
  trlStart: number
  trlEnd: number
  pilots: string[]
  competitiveDifferentiator: string
}

export interface ResolvedCall {
  callId: string
  callTitle: string
  description: string
  actionType: string
  budget?: string
  trlRange?: string
  scopes?: string[]
  isTwoStage: boolean
}

export interface CheckResult {
  id: string
  text: string
}

export interface ComplianceResult {
  passed: CheckResult[]
  warnings: CheckResult[]
  failed: CheckResult[]
  pageCount: Record<string, number>
}

export interface PartnerSuggestion {
  name: string
  acronym: string
  country: string
  type: Partner['type']
  speciality: string
  fitScore: number
  fitReason: string
  previousWork?: string
  source: 'kb' | 'openaire'
}
