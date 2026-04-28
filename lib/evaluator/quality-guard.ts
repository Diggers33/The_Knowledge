import type { AspectAssessment } from './types'

// ─── PATTERNS ─────────────────────────────────────────────────────────────────

const RECOMMENDATION_PATTERNS: RegExp[] = [
  // Direct directive verbs
  /\byou\s+should\b/gi,
  /\bwe\s+recommend\b/gi,
  /\bit\s+is\s+(?:suggested|recommended|advised)\b/gi,
  /\bplease\s+(?:add|include|revise|reconsider|provide|clarify|expand)\b/gi,
  /\bthe\s+authors?\s+(?:should|must|need\s+to|are\s+advised|may\s+wish)\b/gi,
  /\bfuture\s+versions?\s+(?:should|must|need\s+to|may)\b/gi,

  // "could / would / might X" family — with optional adverbs
  /\bcould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?benefit\s+(?:from|by)\b/gi,
  /\bwould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?benefit\s+(?:from|by)\b/gi,
  /\bmight\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?benefit\s+(?:from|by)\b/gi,
  /\bcould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?enhance\b/gi,
  /\bwould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?enhance\b/gi,
  /\bcould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?improve\b/gi,
  /\bwould\s+(?:also\s+|further\s+|usefully\s+|additionally\s+)?improve\b/gi,
  /\bcould\s+further\b/gi,
  /\bcould\s+be\s+(?:strengthened|enhanced|improved|enriched|clarified|expanded|better|more\s+clearly|deepened|broadened)\b/gi,
  /\bmight\s+be\s+(?:strengthened|enhanced|improved|clarified|deepened|broadened)\b/gi,
  /\bwould\s+be\s+(?:strengthened|enhanced|improved|clarified|deepened|broadened)\b/gi,
  /\bwould\s+be\s+improved\s+by\b/gi,

  // The proposal would/could/might …
  /\bthe\s+proposal\s+(?:would|could|might)\s+benefit\b/gi,
  /\bthe\s+proposal\s+(?:would|could|might)\s+be\s+(?:strengthened|enhanced|improved|clarified)\b/gi,

  // "Consider …" family
  /\bconsider\s+(?:adding|including|removing|increasing|reducing|providing|expanding|clarifying|specifying|broadening|deepening)\b/gi,
  /\bworth\s+considering\b/gi,

  // Implicit recommendations: "adding X would / could / might …"
  /\b(?:adding|including|providing|specifying|expanding|clarifying|incorporating)\s+\w+(?:\s+\w+){0,4}\s+(?:would|could|might)\b/gi,

  // "Opportunity / scope / room to …"
  /\b(?:there\s+is\s+)?(?:an?\s+)?opportunity\s+to\s+(?:strengthen|enhance|improve|expand|clarify|deepen|broaden)\b/gi,
  /\b(?:there\s+is\s+)?(?:scope|room)\s+(?:for|to)\s+(?:strengthen|enhance|improve|expand|clarify|deepen|broaden|further\s+development)\b/gi,

  // Soft "more X is needed/required/desirable"
  /\bmore\s+\w+(?:\s+\w+){0,3}\s+(?:is|would\s+be)\s+(?:needed|required|desirable|welcome|beneficial)\b/gi,
]

const COMPARATIVE_PATTERNS: RegExp[] = [
  /\bbetter\s+than\s+(?:other|typical|comparable)\s+proposals\b/gi,
  /\bweaker\s+than\s+(?:other|typical|comparable)\s+proposals\b/gi,
  /\bcompared\s+to\s+other\s+proposals\b/gi,
  /\bin\s+contrast\s+to\s+(?:other|similar)\s+proposals\b/gi,
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

// ─── SENTENCE DROP (Option B) ─────────────────────────────────────────────────

function dropForbiddenSentences(text: string, patterns: RegExp[]): { clean: string; flags: string[] } {
  const flags: string[] = []
  // Split on sentence boundaries (after . ! ?) without consuming the delimiter
  const sentences = text.split(/(?<=[.!?])\s+/)
  const kept: string[] = []

  for (const sentence of sentences) {
    let dropped = false
    for (const p of patterns) {
      const re = new RegExp(p.source, p.flags)
      if (re.test(sentence)) {
        flags.push(`removed sentence: "${sentence.slice(0, 80)}${sentence.length > 80 ? '…' : ''}"`)
        dropped = true
        break
      }
    }
    if (!dropped) kept.push(sentence)
  }

  return { clean: kept.join(' '), flags }
}

// ─── QUALITY GUARD ────────────────────────────────────────────────────────────

export interface QualityGuardResult {
  clean: string
  flags: string[]
}

export function qualityGuard(text: string, score: number): QualityGuardResult {
  const allPatterns = [...RECOMMENDATION_PATTERNS, ...COMPARATIVE_PATTERNS]
  const { clean: dropped, flags } = dropForbiddenSentences(text, allPatterns)

  let clean = dropped

  for (const [re, replacement] of FILLER_REPLACEMENTS) {
    clean = clean.replace(re, replacement)
  }

  // Fabrication guard
  clean = clean.replace(/\b(?:Dr\.|Prof\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g, '[name]')
  clean = clean.replace(/\bH-index\s+(?:of\s+)?\d+/gi, '')

  // Placeholder guard
  clean = clean.replace(/\bXYZ\b|\bpartner\s+X\b|<INSERT|<TBD>|\[TBD\]|\[INSERT/gi, '[TBC]')

  // Score-comment consistency (tone counters)
  const positiveCount = (clean.match(/\b(?:excellent|outstanding|highly\s+credible|fully\s+addresses)\b/gi) || []).length
  const negativeCount = (clean.match(/\b(?:weakness|shortcoming|limited|insufficient|unclear)\b/gi) || []).length
  if (score >= 4.5 && negativeCount > 3) flags.push('comment tone too negative for score ≥ 4.5')
  if (score <= 2.0 && positiveCount > 2) flags.push('comment tone too positive for score ≤ 2.0')

  clean = clean.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()

  return { clean, flags }
}

// ─── ASPECT SANITISER ─────────────────────────────────────────────────────────

export interface AspectLike {
  aspectId?: string
  evidencePointers?: string[]
  strengths?: string[]
  shortcomings?: Array<{ severity: string; text: string }>
  topicAnchor?: string
  [key: string]: unknown
}

export function sanitiseAspect(asp: AspectLike, score: number): { aspect: AspectLike; flags: string[] } {
  const flags: string[] = []

  const cleanStrengths = (asp.strengths ?? []).map((s, i) => {
    const r = qualityGuard(s, score)
    if (r.flags.length) flags.push(`aspect[${asp.aspectId ?? '?'}].strengths[${i}]: ${r.flags.join('; ')}`)
    return r.clean.trim()
  }).filter(Boolean)

  const cleanShortcomings = (asp.shortcomings ?? []).map((sc, i) => {
    const r = qualityGuard(sc.text || '', score)
    if (r.flags.length) flags.push(`aspect[${asp.aspectId ?? '?'}].shortcomings[${i}]: ${r.flags.join('; ')}`)
    return { severity: sc.severity, text: r.clean.trim() }
  }).filter(sc => sc.text)

  return {
    aspect: { ...asp, strengths: cleanStrengths, shortcomings: cleanShortcomings },
    flags,
  }
}

// ─── SCORE-COMMENT CONSISTENCY ────────────────────────────────────────────────

export function checkScoreCommentConsistency(
  comment: string,
  score: number,
  aspects: AspectAssessment[],
): { ok: boolean; reason?: string } {
  const negTokens = (comment.match(/\b(?:weakness|shortcoming|limited|insufficient|unclear|missing|vague|absent|lacking)\b/gi) || []).length
  const posTokens = (comment.match(/\b(?:excellent|outstanding|highly\s+credible|fully\s+addresses|robust|comprehensive|well-defined|detailed)\b/gi) || []).length

  if (score >= 4.5 && negTokens > 1) return { ok: false, reason: `score ${score} but ${negTokens} negative tokens in comment` }
  if (score <= 2.5 && posTokens > 2) return { ok: false, reason: `score ${score} but ${posTokens} positive tokens in comment` }
  if (score >= 4.0 && aspects.every(a => (a.shortcomings?.length ?? 0) === 0)) {
    return { ok: false, reason: 'score ≥4.0 with zero shortcomings recorded across aspects' }
  }

  const scores = aspects.map(a => a.aspectScore)
  if (scores.length > 1 && scores.every(s => s === 3.5)) {
    return { ok: false, reason: 'all aspect scores collapsed to 3.5 — no differentiation' }
  }

  return { ok: true }
}
