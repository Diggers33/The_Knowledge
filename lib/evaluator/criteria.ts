export type ActionType = 'RIA' | 'IA' | 'CSA' | 'CoFund' | 'PCP' | 'PPI' | 'ERC'
export type CriterionId = 'excellence' | 'impact' | 'implementation'

export interface CriterionAspect {
  id: string
  criterion: CriterionId
  text: string
  applicableTo: ActionType[]
  hiddenInPost2026?: boolean
  weight?: number
}

export const ASPECTS: CriterionAspect[] = [
  {
    id: 'EX-1',
    criterion: 'excellence',
    text: 'Clarity and pertinence of the project\'s objectives, and the extent to which the proposed work is ambitious and goes beyond the state-of-the-art.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI', 'ERC'],
  },
  {
    id: 'EX-1-CSA',
    criterion: 'excellence',
    text: 'Clarity and pertinence of the objectives of the proposed coordination and/or support activities.',
    applicableTo: ['CSA'],
  },
  {
    id: 'EX-2',
    criterion: 'excellence',
    text: 'Soundness of the proposed methodology, including underlying concepts, models, assumptions, inter-disciplinary approaches, appropriate consideration of the gender dimension in R&I content, and the quality of open-science practices.',
    applicableTo: ['RIA', 'IA', 'CSA', 'CoFund', 'PCP', 'PPI', 'ERC'],
  },
  {
    id: 'IM-1',
    criterion: 'impact',
    text: 'Credibility of the pathways to achieve the expected outcomes and impacts specified in the work programme.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI', 'CSA'],
  },
  {
    id: 'IM-2',
    criterion: 'impact',
    text: 'Suitability and quality of the measures to maximise expected outcomes and impacts, as set out in the dissemination and exploitation plan, including communication activities.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI', 'CSA'],
  },
  {
    id: 'IM-3',
    criterion: 'impact',
    text: 'Scale and significance of the project\'s contribution to the expected outcomes and impacts.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI'],
    hiddenInPost2026: true,
  },
  {
    id: 'IMPL-1',
    criterion: 'implementation',
    text: 'Quality and effectiveness of the work plan, including the extent to which the resources assigned to work packages are in line with their objectives and deliverables.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI', 'CSA'],
  },
  {
    id: 'IMPL-2',
    criterion: 'implementation',
    text: 'Capacity and role of each participant, and the extent to which the consortium as a whole brings together the necessary expertise.',
    applicableTo: ['RIA', 'IA', 'CoFund', 'PCP', 'PPI', 'CSA'],
  },
]

export function getAspects(actionType: ActionType, post2026: boolean): CriterionAspect[] {
  return ASPECTS.filter(a => {
    if (!a.applicableTo.includes(actionType)) return false
    if (post2026 && a.hiddenInPost2026) return false
    return true
  })
}

export function getCriteria(actionType: ActionType): CriterionId[] {
  if (actionType === 'ERC') return ['excellence']
  return ['excellence', 'impact', 'implementation']
}
