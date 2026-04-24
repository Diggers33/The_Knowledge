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
        description: 'Objectives, ambition, state of the art, methodology',
        evaluationCriteria: 'Soundness of concept, quality of objectives, credibility of proposed approach',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives and ambition',
        pages: 1,
        words: 400,
        mandatory: true,
        description: 'Clear, measurable objectives. Why this is beyond current state of the art.',
      },
      {
        id: 'sota',
        title: '1.2 State of the art and innovation',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Current landscape, recent advances, gaps, why the proposed approach is novel',
      },
      {
        id: 'methodology',
        title: '1.3 Methodology',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Research design, technical approach, risk mitigation, TRL progression',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Expected outcomes, contribution to EU goals, dissemination plan',
        evaluationCriteria: 'Expected outcomes and impacts, quality of measures to maximise impact',
      },
      {
        id: 'outcomes',
        title: '2.1 Expected outcomes and impacts',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'How the project contributes to the call expected outcomes. Quantified where possible.',
      },
      {
        id: 'dissemination',
        title: '2.2 Dissemination and exploitation',
        pages: 1,
        words: 400,
        mandatory: true,
        description: 'How results will be shared, exploited, and standardised',
      },
    ],
  },

  'RIA_stage2': {
    actionType: 'RIA',
    stage: 'stage2',
    totalPages: 43,
    sections: [
      {
        id: 'excellence',
        title: '1. Excellence',
        pages: 15,
        words: 6000,
        mandatory: true,
        description: 'Full scientific and technical excellence case',
        evaluationCriteria: 'Soundness of concept, quality and credibility of methodology',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives and ambition',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'Specific, measurable, achievable objectives. Links to call expected outcomes.',
      },
      {
        id: 'sota',
        title: '1.2 State of the art and innovation',
        pages: 5,
        words: 2000,
        mandatory: true,
        description: 'Comprehensive analysis of current landscape, gaps, and how the project advances beyond SotA',
      },
      {
        id: 'methodology',
        title: '1.3 Methodology',
        pages: 6,
        words: 2400,
        mandatory: true,
        description: 'Research design, technical work plan overview, risk assessment, TRL progression from start to end',
      },
      {
        id: 'innovation',
        title: '1.4 Ambition and innovation',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'What makes this genuinely novel. Breakthrough potential. Links to partnerships.',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'Full impact case — scientific, economic, societal',
        evaluationCriteria: 'Expected outcomes and impacts, quality of exploitation and dissemination plan',
      },
      {
        id: 'outcomes',
        title: '2.1 Expected outcomes and impacts',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Detailed mapping to call expected outcomes. Quantified KPIs. Pathways to impact.',
      },
      {
        id: 'dissemination',
        title: '2.2 Dissemination, exploitation and communication',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Open access plan, IPR strategy, exploitation roadmap, communication activities',
      },
      {
        id: 'communication',
        title: '2.3 Communication',
        pages: 1,
        words: 400,
        mandatory: true,
        description: 'Target audiences, channels, key messages',
      },
      {
        id: 'implementation',
        title: '3. Implementation',
        pages: 17,
        words: 6800,
        mandatory: true,
        description: 'Full work plan, management, consortium',
        evaluationCriteria: 'Quality of work plan, appropriateness of consortium',
      },
      {
        id: 'workplan',
        title: '3.1 Work plan and work packages',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'WP structure, task descriptions, deliverables, milestones, Gantt chart description',
      },
      {
        id: 'management',
        title: '3.2 Management structure',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Governance, decision-making, risk management, quality assurance',
      },
      {
        id: 'consortium',
        title: '3.3 Consortium',
        pages: 5,
        words: 2000,
        mandatory: true,
        description: 'Partner profiles, roles, complementarity, previous collaboration',
      },
      {
        id: 'business_case',
        title: '4. Business Case and Exploitation Strategy',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Market analysis, commercialisation pathway, investment needs, revenue model',
      },
    ],
  },

  'RIA_single': {
    actionType: 'RIA',
    stage: 'single',
    totalPages: 40,
    sections: [
      {
        id: 'excellence',
        title: '1. Excellence',
        pages: 14,
        words: 5600,
        mandatory: true,
        description: 'Full scientific and technical excellence case',
        evaluationCriteria: 'Soundness of concept, quality and credibility of methodology',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives and ambition',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'Specific, measurable, achievable objectives. Links to call expected outcomes.',
      },
      {
        id: 'sota',
        title: '1.2 State of the art and innovation',
        pages: 5,
        words: 2000,
        mandatory: true,
        description: 'Comprehensive analysis of current landscape, gaps, and how the project advances beyond SotA',
      },
      {
        id: 'methodology',
        title: '1.3 Methodology',
        pages: 5,
        words: 2000,
        mandatory: true,
        description: 'Research design, technical work plan overview, risk assessment, TRL progression',
      },
      {
        id: 'innovation',
        title: '1.4 Ambition and innovation',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'What makes this genuinely novel. Breakthrough potential.',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'Full impact case — scientific, economic, societal',
        evaluationCriteria: 'Expected outcomes and impacts, quality of exploitation and dissemination plan',
      },
      {
        id: 'outcomes',
        title: '2.1 Expected outcomes and impacts',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Detailed mapping to call expected outcomes. Quantified KPIs.',
      },
      {
        id: 'dissemination',
        title: '2.2 Dissemination, exploitation and communication',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Open access plan, IPR strategy, exploitation roadmap',
      },
      {
        id: 'communication',
        title: '2.3 Communication',
        pages: 1,
        words: 400,
        mandatory: true,
        description: 'Target audiences, channels, key messages',
      },
      {
        id: 'implementation',
        title: '3. Implementation',
        pages: 15,
        words: 6000,
        mandatory: true,
        description: 'Full work plan, management, consortium',
        evaluationCriteria: 'Quality of work plan, appropriateness of consortium',
      },
      {
        id: 'workplan',
        title: '3.1 Work plan and work packages',
        pages: 7,
        words: 2800,
        mandatory: true,
        description: 'WP structure, task descriptions, deliverables, milestones',
      },
      {
        id: 'management',
        title: '3.2 Management structure',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Governance, decision-making, risk management, quality assurance',
      },
      {
        id: 'consortium',
        title: '3.3 Consortium',
        pages: 5,
        words: 2000,
        mandatory: true,
        description: 'Partner profiles, roles, complementarity, previous collaboration',
      },
    ],
  },

  'IA_stage2': {
    actionType: 'IA',
    stage: 'stage2',
    totalPages: 40,
    sections: [
      {
        id: 'excellence',
        title: '1. Excellence',
        pages: 12,
        words: 4800,
        mandatory: true,
        description: 'Objectives, innovation, methodology focused on deployment and demonstration',
        evaluationCriteria: 'Quality and soundness of concept, innovation potential',
      },
      {
        id: 'objectives',
        title: '1.1 Objectives and innovation',
        pages: 2,
        words: 800,
        mandatory: true,
        description: 'Innovation objectives linked to market and deployment targets',
      },
      {
        id: 'sota',
        title: '1.2 State of the art',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Technology baseline, competitive landscape, and innovation gap',
      },
      {
        id: 'methodology',
        title: '1.3 Methodology and demonstration',
        pages: 6,
        words: 2400,
        mandatory: true,
        description: 'Technical approach, demonstration plan, TRL progression to TRL 7–8',
      },
      {
        id: 'impact',
        title: '2. Impact',
        pages: 10,
        words: 4000,
        mandatory: true,
        description: 'Market impact, commercial pathway, exploitation plan',
        evaluationCriteria: 'Market potential, scale-up credibility, exploitation plan',
      },
      {
        id: 'outcomes',
        title: '2.1 Outcomes and market impact',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Commercial outcomes, market size, KPIs, pathways to market',
      },
      {
        id: 'dissemination',
        title: '2.2 Dissemination and exploitation',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'IP strategy, exploitation roadmap, standards and regulation',
      },
      {
        id: 'business_case',
        title: '2.3 Business case',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Revenue model, investment needs, route to market',
      },
      {
        id: 'implementation',
        title: '3. Implementation',
        pages: 15,
        words: 6000,
        mandatory: true,
        description: 'Work plan, consortium, management',
        evaluationCriteria: 'Quality and efficiency of implementation',
      },
      {
        id: 'workplan',
        title: '3.1 Work plan',
        pages: 8,
        words: 3200,
        mandatory: true,
        description: 'WPs, tasks, deliverables, milestones, Gantt',
      },
      {
        id: 'management',
        title: '3.2 Management',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Governance, IP management, quality plan',
      },
      {
        id: 'consortium',
        title: '3.3 Consortium',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Partner profiles, roles, industrial leadership',
      },
    ],
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
        id: 'outcomes',
        title: '2.1 Expected outcomes',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Policy impact, community building, standardisation outcomes',
      },
      {
        id: 'dissemination',
        title: '2.2 Dissemination and communication',
        pages: 4,
        words: 1600,
        mandatory: true,
        description: 'Outreach plan, target audiences, channels',
      },
      {
        id: 'implementation',
        title: '3. Implementation',
        pages: 12,
        words: 4800,
        mandatory: true,
        description: 'Work plan, management, consortium',
        evaluationCriteria: 'Quality and efficiency of implementation',
      },
      {
        id: 'workplan',
        title: '3.1 Work plan',
        pages: 6,
        words: 2400,
        mandatory: true,
        description: 'WPs, tasks, deliverables, Gantt',
      },
      {
        id: 'management',
        title: '3.2 Management',
        pages: 3,
        words: 1200,
        mandatory: true,
        description: 'Governance, decision-making, quality assurance',
      },
      {
        id: 'consortium',
        title: '3.3 Consortium',
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

  // Detect action type
  let actionType: ActionType = 'RIA'
  if (text.includes('coordination and support action') || text.includes('(csa)')) actionType = 'CSA'
  if (text.includes('innovation action') && !text.includes('research and innovation')) actionType = 'IA'
  if (text.includes('eic accelerator')) actionType = 'EIC'

  // Detect stage
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
