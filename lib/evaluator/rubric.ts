export interface ScoreLabel {
  score: number
  label: string
  definition: string
}

export const SCORE_RUBRIC: ScoreLabel[] = [
  { score: 0, label: '—',         definition: 'Fails to address the criterion or cannot be assessed due to missing or incomplete information.' },
  { score: 1, label: 'Poor',      definition: 'Inadequately addressed, or serious inherent weaknesses.' },
  { score: 2, label: 'Fair',      definition: 'Broadly addresses the criterion, but significant weaknesses.' },
  { score: 3, label: 'Good',      definition: 'Addresses the criterion well, but a number of shortcomings.' },
  { score: 4, label: 'Very Good', definition: 'Addresses the criterion very well, but a small number of shortcomings.' },
  { score: 5, label: 'Excellent', definition: 'Successfully addresses all relevant aspects. Any shortcomings are minor.' },
]

export function getScoreLabel(score: number): ScoreLabel {
  const match = SCORE_RUBRIC.find(r => r.score === Math.round(score))
  return match ?? SCORE_RUBRIC[0]
}

export interface ThresholdResult {
  passesIndividual: boolean
  passesTotal: boolean
  failures: string[]
  totalScore: number
}

export function evaluateThresholds(
  criteria: Array<{ criterion: string; score: number }>,
  thresholds: { individual: number; total: number }
): ThresholdResult {
  const failures: string[] = []
  for (const c of criteria) {
    if (c.score < thresholds.individual) {
      failures.push(`${c.criterion} score ${c.score} below threshold ${thresholds.individual}`)
    }
  }
  const totalScore = criteria.reduce((s, c) => s + c.score, 0)
  if (totalScore < thresholds.total) {
    failures.push(`Total score ${totalScore} below threshold ${thresholds.total}`)
  }
  return {
    passesIndividual: failures.filter(f => !f.startsWith('Total')).length === 0,
    passesTotal: totalScore >= thresholds.total,
    failures,
    totalScore,
  }
}
