export interface AspectAssessment {
  aspectId: string
  evidencePointers: string[]
  strengths: string[]
  shortcomings: Array<{
    severity: 'minor' | 'normal' | 'significant'
    text: string
  }>
  topicAnchor?: string
  aspectScore: number
  scoreJustification: string
}

export interface CriterionAssessment {
  aspects: AspectAssessment[]
  score: number
  comment: string
}
