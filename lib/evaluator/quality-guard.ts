const RECOMMENDATION_PATTERNS = [
  /\byou\s+should\b/gi,
  /\bwe\s+recommend\b/gi,
  /\bconsider\s+(adding|including|removing|increasing|reducing)\b/gi,
  /\bthe\s+proposal\s+would\s+benefit\b/gi,
  /\bit\s+is\s+suggested\b/gi,
  /\bplease\s+(add|include|revise|reconsider)\b/gi,
  /\bwould\s+be\s+improved\s+by\b/gi,
]

const COMPARATIVE_PATTERNS = [
  /\bbetter\s+than\s+(other|typical|comparable)\s+proposals\b/gi,
  /\bweaker\s+than\s+(other|typical|comparable)\s+proposals\b/gi,
  /\bcompared\s+to\s+other\s+proposals\b/gi,
  /\bin\s+contrast\s+to\s+(other|similar)\s+proposals\b/gi,
]

const FILLER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bstate-of-the-art\b/gi, 'state of research'],
  [/\btransformative\b/gi, 'significant'],
  [/\bholistic\b/gi, 'integrated'],
  [/\bit is worth noting\b/gi, ''],
  [/\bit should be highlighted\b/gi, ''],
  [/\bas can be seen\b/gi, ''],
  [/\bneedless to say\b/gi, ''],
  [/\bit is important to mention\b/gi, ''],
]

export interface QualityGuardResult {
  clean: string
  flags: string[]
}

export function qualityGuard(comment: string, score: number): QualityGuardResult {
  const flags: string[] = []
  let clean = comment

  for (const p of [...RECOMMENDATION_PATTERNS, ...COMPARATIVE_PATTERNS]) {
    if (p.test(clean)) {
      flags.push(`forbidden pattern: ${p.source.slice(0, 50)}`)
      clean = clean.replace(new RegExp(p.source, p.flags), '[redacted]')
    }
  }

  for (const [re, replacement] of FILLER_REPLACEMENTS) {
    clean = clean.replace(re, replacement)
  }

  // Fabrication guard
  clean = clean.replace(/\b(?:Dr\.|Prof\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g, '[name]')
  clean = clean.replace(/\bH-index\s+(?:of\s+)?\d+/gi, '')

  // Placeholder guard
  clean = clean.replace(/\bXYZ\b|\bpartner\s+X\b|<INSERT|<TBD>|\[TBD\]|\[INSERT/gi, '[TBC]')

  // Score-comment consistency
  const positiveCount = (clean.match(/\b(excellent|outstanding|highly\s+credible|fully\s+addresses)\b/gi) || []).length
  const negativeCount = (clean.match(/\b(weakness|shortcoming|limited|insufficient|unclear)\b/gi) || []).length
  if (score >= 4.5 && negativeCount > 3) flags.push('comment tone too negative for score ≥ 4.5')
  if (score <= 2.0 && positiveCount > 2) flags.push('comment tone too positive for score ≤ 2.0')

  clean = clean.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()

  return { clean, flags }
}
