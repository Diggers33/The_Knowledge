import { roundToHalf } from './scoring'

export interface EvidenceDensitySignal {
  name: string
  count: number
  weight: number
  cappedAt: number
}

export interface EvidenceDensityScore {
  aspectId: string
  signals: EvidenceDensitySignal[]
  rawScore: number
  bandedScore: number
  bandRationale: string
}

// ─── IMPL-1: Quality and effectiveness of the work plan ───────────────────────

export function scoreIMPL1(proposalText: string): EvidenceDensityScore {
  const wpMatches = proposalText.match(/\bWP\s*\d+\b/gi) ?? []
  const uniqueWPs = new Set(wpMatches.map(s => s.toUpperCase().replace(/\s+/g, ''))).size

  const deliverableIds = (proposalText.match(/\bD\d+\.\d+\b/g) ?? []).length
  const milestoneIds = (proposalText.match(/\bM\d+\.\d+\b/g) ?? []).length
  const taskIds = (proposalText.match(/\bT\d+\.\d+\b/g) ?? []).length

  const ganttHits = (proposalText.match(/\bGantt\b|\bmonth\s+\d+\b|month-\d+|\bM\d{1,2}\b/gi) ?? []).length > 5 ? 1 : 0
  const riskRegister = /risk\s+(?:register|table|matrix)/i.test(proposalText) ? 1 : 0
  const mitigations = (proposalText.match(/\bmitigation\s*[:–\-]/gi) ?? []).length
  const kpiTargets = (proposalText.match(/\bKPI\s*\d+|\btarget[:\s]+\d+/gi) ?? []).length

  const signals: EvidenceDensitySignal[] = [
    { name: 'Unique work packages', count: uniqueWPs, weight: 1.0, cappedAt: 7 },
    { name: 'Numbered deliverables (D#.#)', count: deliverableIds, weight: 1.0, cappedAt: 15 },
    { name: 'Numbered milestones (M#.#)', count: milestoneIds, weight: 0.5, cappedAt: 8 },
    { name: 'Numbered tasks (T#.#)', count: taskIds, weight: 0.5, cappedAt: 20 },
    { name: 'Gantt / month references', count: ganttHits, weight: 0.5, cappedAt: 1 },
    { name: 'Risk register present', count: riskRegister, weight: 0.5, cappedAt: 1 },
    { name: 'Named risk mitigations', count: mitigations, weight: 0.5, cappedAt: 5 },
    { name: 'KPIs with targets', count: kpiTargets, weight: 0.5, cappedAt: 5 },
  ]

  const raw = signals.reduce((s, sig) => s + Math.min(sig.count / sig.cappedAt, 1) * sig.weight, 0)
  const bandedScore = roundToHalf(Math.min(raw, 5))

  return {
    aspectId: 'IMPL-1',
    signals,
    rawScore: raw,
    bandedScore,
    bandRationale: `Evidence-density: ${uniqueWPs} WPs, ${deliverableIds} deliverables, ${milestoneIds} milestones, ${taskIds} tasks, gantt=${ganttHits}, risk-register=${riskRegister}, ${mitigations} mitigations, ${kpiTargets} KPI targets → raw ${raw.toFixed(2)} → banded ${bandedScore}`,
  }
}

// ─── IMPL-2: Capacity and role of each participant ───────────────────────────

export function scoreIMPL2(proposalText: string, partners: string[]): EvidenceDensityScore {
  const partnerCount = partners.length > 0
    ? partners.length
    : (proposalText.match(/\bParticipant\s+\d+|\bPartner\s+\d+/gi) ?? []).length

  const namedRoles = (proposalText.match(
    /\b(?:coordinator|technical\s+lead|WP\s+leader|task\s+leader|project\s+manager)\b/gi
  ) ?? []).length

  const expertiseLines = (proposalText.match(
    /\bexpertise\s+in\b|\bspecialise[sd]?\s+in\b|\bleading\s+(?:expert|institution|research)\b/gi
  ) ?? []).length

  const sme = /\bSME\b/.test(proposalText) ? 1 : 0

  const countryTokens = proposalText.match(
    /\b(?:Germany|France|Italy|Spain|Netherlands|Belgium|Austria|Poland|Portugal|Greece|Finland|Sweden|Denmark|Ireland|Czechia|Romania|Hungary|Slovakia|Bulgaria|Croatia|DE|FR|IT|ES|NL|BE|AT|PL|PT|GR|EL|FI|SE|DK|IE|CZ|RO|HU|SK|BG|HR)\b/g
  ) ?? []
  const geographicSpread = new Set(countryTokens.map(t => t.toUpperCase())).size

  const signals: EvidenceDensitySignal[] = [
    { name: 'Partner count', count: partnerCount, weight: 1.0, cappedAt: 8 },
    { name: 'Named roles (coord/lead/WP-leader)', count: namedRoles, weight: 1.0, cappedAt: 8 },
    { name: 'Stated expertise lines', count: expertiseLines, weight: 1.0, cappedAt: 8 },
    { name: 'SME participation', count: sme, weight: 0.5, cappedAt: 1 },
    { name: 'Country diversity', count: geographicSpread, weight: 1.0, cappedAt: 4 },
  ]

  const raw = signals.reduce((s, sig) => s + Math.min(sig.count / sig.cappedAt, 1) * sig.weight, 0)
  const bandedScore = roundToHalf(Math.min(raw, 5))

  return {
    aspectId: 'IMPL-2',
    signals,
    rawScore: raw,
    bandedScore,
    bandRationale: `Evidence-density: ${partnerCount} partners, ${namedRoles} named roles, ${expertiseLines} expertise lines, sme=${sme}, ${geographicSpread} countries → raw ${raw.toFixed(2)} → banded ${bandedScore}`,
  }
}
