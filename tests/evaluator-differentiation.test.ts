import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { scoreIMPL1, scoreIMPL2 } from '../lib/evaluator/evidence-density'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures/synthetic', name), 'utf-8')
}

const WEAK = fixture('weak-stub.txt')
const STRONG = fixture('strong-stub.txt')

// ─── IMPL-1: Work plan evidence density ──────────────────────────────────────

describe('scoreIMPL1 — work plan evidence density', () => {
  test('weak stub scores ≤1.5 on IMPL-1', () => {
    const r = scoreIMPL1(WEAK)
    expect(r.bandedScore).toBeLessThanOrEqual(1.5)
  })

  test('strong stub scores ≥4.0 on IMPL-1', () => {
    const r = scoreIMPL1(STRONG)
    expect(r.bandedScore).toBeGreaterThanOrEqual(4.0)
  })

  test('strong stub has more WPs than weak stub', () => {
    const weak = scoreIMPL1(WEAK)
    const strong = scoreIMPL1(STRONG)
    const wpWeak = weak.signals.find(s => s.name === 'Unique work packages')!.count
    const wpStrong = strong.signals.find(s => s.name === 'Unique work packages')!.count
    expect(wpStrong).toBeGreaterThan(wpWeak)
  })

  test('strong stub has D-IDs; weak stub has none', () => {
    const weak = scoreIMPL1(WEAK)
    const strong = scoreIMPL1(STRONG)
    expect(weak.signals.find(s => s.name === 'Numbered deliverables')!.count).toBe(0)
    expect(strong.signals.find(s => s.name === 'Numbered deliverables')!.count).toBeGreaterThanOrEqual(16)
  })

  test('strong stub has risk register; weak stub does not', () => {
    const weak = scoreIMPL1(WEAK)
    const strong = scoreIMPL1(STRONG)
    expect(weak.signals.find(s => s.name === 'Risk register present')!.count).toBe(0)
    expect(strong.signals.find(s => s.name === 'Risk register present')!.count).toBe(1)
  })

  test('strong stub has named mitigations; weak stub has none', () => {
    const weak = scoreIMPL1(WEAK)
    const strong = scoreIMPL1(STRONG)
    expect(weak.signals.find(s => s.name === 'Named risk mitigations')!.count).toBe(0)
    expect(strong.signals.find(s => s.name === 'Named risk mitigations')!.count).toBeGreaterThanOrEqual(5)
  })

  test('score delta between strong and weak is ≥2.5', () => {
    const weak = scoreIMPL1(WEAK)
    const strong = scoreIMPL1(STRONG)
    expect(strong.bandedScore - weak.bandedScore).toBeGreaterThanOrEqual(2.5)
  })

  test('returns bandRationale as non-empty string', () => {
    const r = scoreIMPL1(STRONG)
    expect(r.bandRationale.length).toBeGreaterThan(20)
  })
})

// ─── IMPL-2: Consortium evidence density ─────────────────────────────────────

describe('scoreIMPL2 — consortium evidence density', () => {
  test('weak stub scores ≤1.0 on IMPL-2 (2 partners, 1 country)', () => {
    const r = scoreIMPL2(WEAK, [])
    expect(r.bandedScore).toBeLessThanOrEqual(1.5)
  })

  test('strong stub scores ≥4.0 on IMPL-2', () => {
    const r = scoreIMPL2(STRONG, [
      'EMPA', 'FEUP', 'UNIMORE', 'NTUA', 'CNRS', 'AMAZEMET', 'IRIS', 'Fraunhofer IPT', 'VTT', 'AMAZE-Consulting',
    ])
    expect(r.bandedScore).toBeGreaterThanOrEqual(4.0)
  })

  test('strong stub registers SME participation', () => {
    const r = scoreIMPL2(STRONG, [])
    expect(r.signals.find(s => s.name === 'SME participation')!.count).toBe(1)
  })

  test('strong stub has higher country diversity than weak stub', () => {
    const weak = scoreIMPL2(WEAK, [])
    const strong = scoreIMPL2(STRONG, [])
    const cdWeak = weak.signals.find(s => s.name === 'Country diversity')!.count
    const cdStrong = strong.signals.find(s => s.name === 'Country diversity')!.count
    expect(cdStrong).toBeGreaterThan(cdWeak)
  })

  test('explicit partner list overrides text-parsed count', () => {
    const partners = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
    const r = scoreIMPL2('Some text.', partners)
    expect(r.signals.find(s => s.name === 'Partner count')!.count).toBe(8)
  })
})

// ─── Evidence-floor sanity ────────────────────────────────────────────────────

describe('Evidence-density score boundaries', () => {
  test('bandedScore is always in 0..5 range', () => {
    for (const text of [WEAK, STRONG, '']) {
      const r1 = scoreIMPL1(text)
      const r2 = scoreIMPL2(text, [])
      expect(r1.bandedScore).toBeGreaterThanOrEqual(0)
      expect(r1.bandedScore).toBeLessThanOrEqual(5)
      expect(r2.bandedScore).toBeGreaterThanOrEqual(0)
      expect(r2.bandedScore).toBeLessThanOrEqual(5)
    }
  })

  test('empty text gives bandedScore 0', () => {
    const r1 = scoreIMPL1('')
    const r2 = scoreIMPL2('', [])
    expect(r1.bandedScore).toBe(0)
    expect(r2.bandedScore).toBe(0)
  })

  test('bandedScore is a multiple of 0.5', () => {
    const r = scoreIMPL1(STRONG)
    expect((r.bandedScore * 2) % 1).toBe(0)
  })
})
