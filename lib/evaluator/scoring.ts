import type { AspectAssessment } from './types'

export function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2
}

export function enforceEvidenceFloor(a: AspectAssessment): number {
  let s = a.aspectScore ?? 0
  const evCount = a.evidencePointers?.length ?? 0
  const strCount = a.strengths?.length ?? 0
  const normalShortcomings = (a.shortcomings ?? []).filter(x => x.severity !== 'minor').length
  const allShortcomings = a.shortcomings?.length ?? 0

  // score ≥ 4.0 requires ≥2 evidencePointers AND ≥2 strengths AND ≤1 normal-severity shortcoming
  if (s >= 4.0 && (evCount < 2 || strCount < 2 || normalShortcomings > 1)) s = 3.5
  // score ≥ 3.0 requires ≥1 evidencePointer AND ≥1 strength
  if (s >= 3.0 && (evCount < 1 || strCount < 1)) s = 2.5
  // score < 5.0 requires ≥1 shortcoming
  if (s < 5.0 && allShortcomings === 0) s = Math.min(s, 4.5)
  // score < 3.0 with no normal/significant shortcomings articulated — upgrade to 3.0
  if (s < 3.0 && normalShortcomings === 0) s = 3.0

  return Math.max(0, Math.min(5, roundToHalf(s)))
}

export function aggregateAspectScores(
  assessments: AspectAssessment[],
  weights: number[],
): number {
  if (assessments.length === 0) return 0
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const weightedSum = assessments.reduce((s, a, i) => s + a.aspectScore * (weights[i] ?? 1), 0)
  return roundToHalf(weightedSum / totalWeight)
}
