import type { EvidenceDensitySignal } from './evidence-density'

export type ScoreSource = 'computed' | 'comparative-ensemble' | 'judgement'

// ─── Multimodal proposal document (Tier 3) ───────────────────────────────────

export interface StructuredTableRow {
  cells: string[]
}

export type TableKind =
  | 'risk'
  | 'kpi'
  | 'wp_summary'
  | 'deliverable'
  | 'milestone'
  | 'partner'
  | 'budget'
  | 'unknown'

export interface StructuredTable {
  pageNumber: number
  header: string[] | null
  rows: StructuredTableRow[]
  kind: TableKind
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface FigurePage {
  pageNumber: number
  dataUrl: string
  width: number
  height: number
  hint: 'gantt' | 'pert' | 'flow' | 'architecture' | 'photo' | 'unknown'
  caption: string | null
}

export interface ProposalDocument {
  text: string
  tables: StructuredTable[]
  figures: FigurePage[]
  meta: {
    pageCount: number
    extractionVersion: 'v2'
    isDocx: boolean
  }
}

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
