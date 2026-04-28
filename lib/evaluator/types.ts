import type { EvidenceDensitySignal } from './evidence-density'

export type ScoreSource = 'computed' | 'comparative-ensemble' | 'judgement'

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
  scoreSource: ScoreSource
  scoreJustification: string
  evidenceDensitySignals?: EvidenceDensitySignal[]
  scoreSamples?: number[]
  scoreStdDev?: number
}

export interface CriterionAssessment {
  aspects: AspectAssessment[]
  score: number
  comment: string
}
