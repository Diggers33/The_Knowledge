import { describe, test, expect } from 'vitest'
import { scoreIMPL1, scoreIMPL2 } from '../lib/evaluator/evidence-density'
import type { ProposalDocument, StructuredTable, StructuredTableRow } from '../lib/evaluator/types'

function makeDoc(overrides: Partial<ProposalDocument> = {}): ProposalDocument {
  return {
    text: '',
    tables: [],
    figures: [],
    meta: { pageCount: 40, extractionVersion: 'v2', isDocx: false },
    ...overrides,
  }
}

function makeTable(kind: StructuredTable['kind'], rows: string[][]): StructuredTable {
  return {
    pageNumber: 1,
    header: null,
    rows: rows.map(cells => ({ cells } as StructuredTableRow)),
    kind,
    bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
  }
}

// ─── Table-aware IMPL-1 ───────────────────────────────────────────────────────

describe('Tier 3 — IMPL-1 table-aware scoring', () => {
  test('WP summary table overrides regex count', () => {
    // text has only WP1, but table has 6 rows → prefers table
    const doc = makeDoc({
      text: 'WP1 is the main work package.',
      tables: [makeTable('wp_summary', [
        ['WP1', 'Lead'], ['WP2', 'EMPA'], ['WP3', 'FEUP'],
        ['WP4', 'NTUA'], ['WP5', 'CNRS'], ['WP6', 'VTT'],
      ])],
    })
    const r = scoreIMPL1(doc)
    expect(r.signals.find(s => s.name === 'Unique work packages')!.count).toBe(6)
    expect(r.signals.find(s => s.name === 'Unique work packages')!.source).toBe('table')
  })

  test('deliverable table overrides regex (source=table)', () => {
    const delivRows = Array.from({ length: 20 }, (_, i) => [`D${Math.floor(i / 4) + 1}.${(i % 4) + 1}`, 'Report', 'M12'])
    const doc = makeDoc({ tables: [makeTable('deliverable', delivRows)] })
    const r = scoreIMPL1(doc)
    expect(r.signals.find(s => s.name === 'Numbered deliverables')!.count).toBe(20)
    expect(r.signals.find(s => s.name === 'Numbered deliverables')!.source).toBe('table')
  })

  test('risk table with mitigation column counted correctly', () => {
    const doc = makeDoc({
      tables: [makeTable('risk', [
        ['Risk 1', 'High', 'Severe', 'mitigate by increasing buffer 30%'],
        ['Risk 2', 'Low',  'Minor',  'mitigate by parallel track'],
        ['Risk 3', 'Med',  'Normal', 'mitigation plan reviewed quarterly'],
      ])],
    })
    const r = scoreIMPL1(doc)
    expect(r.signals.find(s => s.name === 'Risk register present')!.count).toBe(1)
    expect(r.signals.find(s => s.name === 'Named risk mitigations')!.count).toBe(3)
    expect(r.signals.find(s => s.name === 'Risk register present')!.source).toBe('table')
  })

  test('falls back to regex when no tables present', () => {
    const doc = makeDoc({ text: 'WP1 covers research. WP2 covers dissemination. D1.1 is the first deliverable.' })
    const r = scoreIMPL1(doc)
    expect(r.signals.find(s => s.name === 'Unique work packages')!.source).toBe('regex')
    expect(r.signals.find(s => s.name === 'Numbered deliverables')!.source).toBe('regex')
  })

  test('empty tables falls back to regex', () => {
    const doc = makeDoc({
      text: 'WP1 WP2 WP3 D1.1 D1.2 D2.1',
      tables: [makeTable('wp_summary', [])],
    })
    const r = scoreIMPL1(doc)
    // empty wp_summary table → 0 rows → falls back to regex (3 WPs)
    expect(r.signals.find(s => s.name === 'Unique work packages')!.count).toBe(3)
    expect(r.signals.find(s => s.name === 'Unique work packages')!.source).toBe('regex')
  })

  test('full table-based doc scores ≥ 4.0', () => {
    const wpRows = Array.from({ length: 7 }, (_, i) => [`WP${i + 1}`, 'Lead', '12 PM'])
    const dRows = Array.from({ length: 15 }, (_, i) => [`D${Math.floor(i / 3) + 1}.${(i % 3) + 1}`, 'Report', 'M12'])
    const mRows = Array.from({ length: 8 }, (_, i) => [`MS${i + 1}`, 'Passed', 'M' + (i * 6 + 6)])
    const riskRows = Array.from({ length: 5 }, (_, i) => [
      `Risk ${i + 1}`, 'Medium', 'Normal', `mitigation strategy ${i + 1} applied`,
    ])
    const kpiRows = Array.from({ length: 5 }, (_, i) => [
      `KPI ${i + 1}`, 'Baseline', `${(i + 1) * 20}% by 2027`,
    ])
    const doc = makeDoc({
      text: 'Gantt chart in Annex. Month 6 review. Month 12 milestone.',
      tables: [
        makeTable('wp_summary', wpRows),
        makeTable('deliverable', dRows),
        makeTable('milestone', mRows),
        makeTable('risk', riskRows),
        makeTable('kpi', kpiRows),
      ],
    })
    const r = scoreIMPL1(doc)
    expect(r.bandedScore).toBeGreaterThanOrEqual(4.0)
  })
})

// ─── Table-aware IMPL-2 ───────────────────────────────────────────────────────

describe('Tier 3 — IMPL-2 table-aware scoring', () => {
  test('partner table row count overrides explicit partners list', () => {
    const partnerRows = Array.from({ length: 10 }, (_, i) => [`Partner ${i + 1}`, 'Research org', 'DE'])
    const doc = makeDoc({ tables: [makeTable('partner', partnerRows)] })
    const r = scoreIMPL2(doc, ['P1', 'P2'])
    expect(r.signals.find(s => s.name === 'Partner count')!.count).toBe(10)
    expect(r.signals.find(s => s.name === 'Partner count')!.source).toBe('table')
  })

  test('country diversity extracted from partner table column 2', () => {
    const partnerRows = [
      ['EMPA', 'Research', 'CH'],
      ['FEUP', 'University', 'PT'],
      ['NTUA', 'University', 'GR'],
      ['CNRS', 'Research', 'FR'],
    ]
    const doc = makeDoc({ tables: [makeTable('partner', partnerRows)] })
    const r = scoreIMPL2(doc, [])
    expect(r.signals.find(s => s.name === 'Country diversity')!.count).toBe(4)
    expect(r.signals.find(s => s.name === 'Country diversity')!.source).toBe('table')
  })

  test('string input still works (backward compat)', () => {
    const r = scoreIMPL2('Two partners: Partner 1 in DE, Partner 2 in FR. SME involved.', [])
    expect(r.bandedScore).toBeGreaterThanOrEqual(0)
    expect(r.bandedScore).toBeLessThanOrEqual(5)
    expect(r.signals.find(s => s.name === 'SME participation')!.count).toBe(1)
  })
})

// ─── Score boundaries with ProposalDocument input ────────────────────────────

describe('Tier 3 — score boundaries with ProposalDocument input', () => {
  test('empty ProposalDocument gives bandedScore 0', () => {
    const doc = makeDoc({ text: '' })
    expect(scoreIMPL1(doc).bandedScore).toBe(0)
    expect(scoreIMPL2(doc, []).bandedScore).toBe(0)
  })

  test('bandedScore is always in 0..5 range', () => {
    const doc = makeDoc({
      text: 'WP1 WP2 D1.1 D2.1',
      tables: [makeTable('wp_summary', [['WP1', 'Lead'], ['WP2', 'Partner']])],
    })
    const r1 = scoreIMPL1(doc)
    const r2 = scoreIMPL2(doc, [])
    expect(r1.bandedScore).toBeGreaterThanOrEqual(0)
    expect(r1.bandedScore).toBeLessThanOrEqual(5)
    expect(r2.bandedScore).toBeGreaterThanOrEqual(0)
    expect(r2.bandedScore).toBeLessThanOrEqual(5)
  })

  test('bandedScore is a multiple of 0.5', () => {
    const doc = makeDoc({
      text: 'WP1 WP2 WP3 WP4 D1.1 D1.2 D2.1 D3.1',
      tables: [makeTable('milestone', [['MS1', 'Go/NoGo', 'M12'], ['MS2', 'Final', 'M36']])],
    })
    const r = scoreIMPL1(doc)
    expect((r.bandedScore * 2) % 1).toBe(0)
  })
})

// ─── Regression: string path still works (back-compat for old callers) ───────

describe('Tier 3 — string backward compatibility', () => {
  test('scoreIMPL1(string) still produces correct signal names', () => {
    const r = scoreIMPL1('WP1 WP2 D1.1 Risk register table mitigation: contingency plan')
    const names = r.signals.map(s => s.name)
    expect(names).toContain('Unique work packages')
    expect(names).toContain('Numbered deliverables')
    expect(names).toContain('Risk register present')
  })

  test('scoreIMPL2(string, []) still returns source=regex for all signals', () => {
    const r = scoreIMPL2('Partner 1 in DE Partner 2 in FR coordinator and WP leader', [])
    for (const sig of r.signals) {
      expect(sig.source).toBe('regex')
    }
  })
})
