export interface CallTopicConditions {
  requiresSSH: boolean
  requiresAIRobustness: boolean
  requiresDNSH: boolean
  trlAtStart: number | null
  trlAtEnd: number | null
  durationMonths: number | null
  indicativeBudget: string
  civilApplicationsOnly: boolean
  openScienceMandatory: boolean
}

export interface CallTopic {
  topicId: string
  topicTitle: string
  destination: string
  cluster: string
  partnership: string
  expectedOutcomes: string[]
  scope: string
  specificConditions: CallTopicConditions
}

export function emptyCallTopic(): CallTopic {
  return {
    topicId: '',
    topicTitle: '',
    destination: '',
    cluster: '',
    partnership: '',
    expectedOutcomes: [],
    scope: '',
    specificConditions: {
      requiresSSH: false,
      requiresAIRobustness: false,
      requiresDNSH: false,
      trlAtStart: null,
      trlAtEnd: null,
      durationMonths: null,
      indicativeBudget: '',
      civilApplicationsOnly: false,
      openScienceMandatory: false,
    },
  }
}

export function isTopicLoaded(topic: CallTopic): boolean {
  return !!(topic.topicId.trim() || topic.topicTitle.trim())
}

export function buildCallContextBlock(topic: CallTopic): string {
  const lines: string[] = ['=== CALL / TOPIC CONTEXT ===']

  if (topic.topicId) lines.push(`Topic ID: ${topic.topicId}`)
  if (topic.topicTitle) lines.push(`Topic Title: ${topic.topicTitle}`)
  if (topic.destination) lines.push(`Destination: ${topic.destination}`)
  if (topic.cluster) lines.push(`Cluster: ${topic.cluster}`)
  if (topic.partnership) lines.push(`Partnership/Mission: ${topic.partnership}`)

  if (topic.expectedOutcomes.length > 0) {
    lines.push('')
    lines.push('Expected Outcomes (from call text):')
    topic.expectedOutcomes.forEach((o, i) => lines.push(`EO${i + 1}. ${o}`))
  }

  if (topic.scope.trim()) {
    lines.push('')
    lines.push('Scope:')
    lines.push(topic.scope.trim())
  }

  const cond = topic.specificConditions
  const flags: string[] = []
  if (cond.requiresSSH) flags.push('SSH integration required')
  if (cond.requiresAIRobustness) flags.push('AI robustness assessment required')
  if (cond.requiresDNSH) flags.push('Do No Significant Harm (DNSH) assessment required')
  if (cond.civilApplicationsOnly) flags.push('Civil applications only')
  if (cond.openScienceMandatory) flags.push('Open science mandatory')
  if (cond.trlAtStart !== null) flags.push(`Expected TRL at start: ${cond.trlAtStart}`)
  if (cond.trlAtEnd !== null) flags.push(`Expected TRL at end: ${cond.trlAtEnd}`)
  if (cond.durationMonths !== null) flags.push(`Maximum duration: ${cond.durationMonths} months`)
  if (cond.indicativeBudget) flags.push(`Indicative budget: ${cond.indicativeBudget}`)

  if (flags.length > 0) {
    lines.push('')
    lines.push('Specific Conditions:')
    flags.forEach(f => lines.push(`• ${f}`))
  }

  lines.push('')
  lines.push('When assessing each aspect, explicitly note which Expected Outcomes (EO1, EO2…) the proposal addresses. Include this in the topicAnchor field of each aspect JSON object.')

  return lines.join('\n')
}
