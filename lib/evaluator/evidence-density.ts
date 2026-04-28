import { roundToHalf } from './scoring'
import type { ProposalDocument } from './types'

export interface EvidenceDensitySignal {
  name: string
  count: number
  weight: number
  cappedAt: number
  source: 'table' | 'regex'
}

export interface EvidenceDensityScore {
  aspectId: string
  signals: EvidenceDensitySignal[]
  rawScore: number
  bandedScore: number
  bandRationale: string
}

// ─── IMPL-1: Quality and effectiveness of the work plan ───────────────────────

export function scoreIMPL1(input: string | ProposalDocument): EvidenceDensityScore {
  const isDoc = typeof input !== 'string'
  const text = isDoc ? input.text : input
  const tables = isDoc ? input.tables : []

  const wpTable = tables.find(t => t.kind === 'wp_summary')
  const dTable = tables.find(t => t.kind === 'deliverable')
  const mTable = tables.find(t => t.kind === 'milestone')
  const riskTable = tables.find(t => t.kind === 'risk')
  const kpiTable = tables.find(t => t.kind === 'kpi')

  const wpRows = wpTable?.rows.length ?? 0
  const dRows = dTable?.rows.length ?? 0
  const mRows = mTable?.rows.length ?? 0

  const broaderD = /\bD\s*[-]?\s*\d+\.\d+\b|\bDeliverable\s+\d+\.\d+/gi
  const broaderM = /\bM\s*[-]?\s*\d+\.\d+\b|\bMilestone\s+\d+\.\d+/gi
  const broaderT = /\bT\s*[-]?\s*\d+\.\d+\b|\bTask\s+\d+\.\d+/gi
  const broaderWP = /\bWP\s*\d+\b/gi

  const wpRegex = new Set((text.match(broaderWP) ?? []).map(s => s.toUpperCase().replace(/\s+/g, ''))).size
  const dRegex = (text.match(broaderD) ?? []).length
  const mRegex = (text.match(broaderM) ?? []).length
  const tRegex = (text.match(broaderT) ?? []).length

  const ganttHits = (text.match(/\bGantt\b|\bmonth\s+\d+\b|month-\d+|\bM\d{1,2}\b/gi) ?? []).length > 5 ? 1 : 0
  const mitigations = riskTable
    ? riskTable.rows.filter(r => r.cells.some(c => /\bmitigat/i.test(c))).length
    : (text.match(/\bmitigation\s*[:–\-]/gi) ?? []).length
  const kpiTargets = kpiTable
    ? kpiTable.rows.filter(r => r.cells.some(c => /\d+\s*%|\d+\s*[a-z]+\s*by/i.test(c))).length
    : (text.match(/\bKPI\s*\d+|\btarget[:\s]+\d+/gi) ?? []).length

  const wp = wpRows > 0 ? wpRows : wpRegex
  const d = dRows > 0 ? dRows : dRegex
  const m = mRows > 0 ? mRows : mRegex
  const t = tRegex
  const risk = riskTable ? 1 : (/risk\s+(?:register|table|matrix)/i.test(text) ? 1 : 0)

  const sourceOf = (tableCount: number): 'table' | 'regex' => tableCount > 0 ? 'table' : 'regex'

  const signals: EvidenceDensitySignal[] = [
    { name: 'Unique work packages', count: wp, weight: 1.0, cappedAt: 7, source: sourceOf(wpRows) },
    { name: 'Numbered deliverables', count: d, weight: 1.0, cappedAt: 15, source: sourceOf(dRows) },
    { name: 'Numbered milestones', count: m, weight: 0.5, cappedAt: 8, source: sourceOf(mRows) },
    { name: 'Numbered tasks', count: t, weight: 0.5, cappedAt: 20, source: 'regex' },
    { name: 'Gantt / month references', count: ganttHits, weight: 0.5, cappedAt: 1, source: 'regex' },
    { name: 'Risk register present', count: risk, weight: 0.5, cappedAt: 1, source: riskTable ? 'table' : 'regex' },
    { name: 'Named risk mitigations', count: mitigations, weight: 0.5, cappedAt: 5, source: riskTable ? 'table' : 'regex' },
    { name: 'KPIs with targets', count: kpiTargets, weight: 0.5, cappedAt: 5, source: kpiTable ? 'table' : 'regex' },
  ]

  const raw = signals.reduce((s, sig) => s + Math.min(sig.count / sig.cappedAt, 1) * sig.weight, 0)
  const bandedScore = roundToHalf(Math.min(raw, 5))

  return {
    aspectId: 'IMPL-1',
    signals,
    rawScore: raw,
    bandedScore,
    bandRationale: `Evidence-density (table-aware): ${wp} WPs, ${d} deliverables, ${m} milestones, ${t} tasks, gantt=${ganttHits}, risk-register=${risk}, ${mitigations} mitigations, ${kpiTargets} KPI targets → raw ${raw.toFixed(2)} → banded ${bandedScore}`,
  }
}

// ─── IMPL-2: Capacity and role of each participant ───────────────────────────

export function scoreIMPL2(
  input: string | ProposalDocument,
  partners: string[],
): EvidenceDensityScore {
  const isDoc = typeof input !== 'string'
  const text = isDoc ? input.text : input
  const tables = isDoc ? input.tables : []
  const partnerTable = tables.find(t => t.kind === 'partner')

  const partnerCountTable = partnerTable?.rows.length ?? 0
  const partnerCountRegex = partners.length > 0
    ? partners.length
    : (text.match(/\bParticipant\s+\d+|\bPartner\s+\d+/gi) ?? []).length
  const partnerCount = partnerCountTable > 0 ? partnerCountTable : partnerCountRegex

  const namedRoles = (text.match(/\b(?:coordinator|technical\s+lead|WP\s+leader|task\s+leader|project\s+manager)\b/gi) ?? []).length
  const expertiseLines = (text.match(/\bexpertise\s+in\b|\bspecialise[sd]?\s+in\b|\bleading\s+(?:expert|institution|research)\b/gi) ?? []).length
  const sme = /\bSME\b/.test(text) ? 1 : 0

  const countriesFromTable = partnerTable
    ? new Set(partnerTable.rows.map(r => (r.cells[2] ?? r.cells[1] ?? '').trim().toUpperCase()).filter(Boolean)).size
    : 0
  const countryRegex = (text.match(/\b(?:Germany|France|Italy|Spain|Netherlands|Belgium|Austria|Poland|Portugal|Greece|Finland|Sweden|Denmark|Ireland|Czechia|Romania|Hungary|Slovakia|Bulgaria|Croatia|DE|FR|IT|ES|NL|BE|AT|PL|PT|GR|EL|FI|SE|DK|IE|CZ|RO|HU|SK|BG|HR)\b/g) ?? [])
  const countriesFromRegex = new Set(countryRegex.map(c => c.toUpperCase())).size
  const geographicSpread = countriesFromTable > 0 ? countriesFromTable : countriesFromRegex

  const signals: EvidenceDensitySignal[] = [
    { name: 'Partner count', count: partnerCount, weight: 1.0, cappedAt: 8, source: partnerCountTable > 0 ? 'table' : 'regex' },
    { name: 'Named roles', count: namedRoles, weight: 1.0, cappedAt: 8, source: 'regex' },
    { name: 'Stated expertise lines', count: expertiseLines, weight: 1.0, cappedAt: 8, source: 'regex' },
    { name: 'SME participation', count: sme, weight: 0.5, cappedAt: 1, source: 'regex' },
    { name: 'Country diversity', count: geographicSpread, weight: 1.0, cappedAt: 4, source: countriesFromTable > 0 ? 'table' : 'regex' },
  ]

  const raw = signals.reduce((s, sig) => s + Math.min(sig.count / sig.cappedAt, 1) * sig.weight, 0)
  const bandedScore = roundToHalf(Math.min(raw, 5))

  return {
    aspectId: 'IMPL-2',
    signals,
    rawScore: raw,
    bandedScore,
    bandRationale: `Evidence-density (table-aware): ${partnerCount} partners, ${namedRoles} named roles, ${expertiseLines} expertise lines, sme=${sme}, ${geographicSpread} countries → raw ${raw.toFixed(2)} → banded ${bandedScore}`,
  }
}
