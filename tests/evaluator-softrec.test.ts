import { describe, test, expect } from 'vitest'
import { qualityGuard, sanitiseAspect } from '../lib/evaluator/quality-guard'

// ─── Must FLAG (recommendation-style language) ────────────────────────────────

describe('Soft-rec regex coverage — must flag all of:', () => {
  const mustFlag = [
    'The proposal could benefit from a more detailed risk register.',
    'The work plan could also benefit from explicit milestones.',
    'The methodology could enhance the dissemination strategy.',
    'The consortium would benefit from earlier engagement with end-users.',
    'The plan could be strengthened with named deliverables.',
    'The plan could be deepened around exploitation.',
    'There is an opportunity to strengthen the impact pathway.',
    'There is room for further development of the open-science plan.',
    'Adding KPIs to WP3 would improve traceability.',
    'Including a Gantt chart would clarify the timeline.',
    'More detail on TRL transitions is needed.',
    'Worth considering a wider geographic spread.',
    'Future versions should include a DNSH self-assessment.',
    'The authors may wish to revisit the budget allocation.',
    'Please clarify the role of partner X.',
    'It is recommended to include an ethics advisory board.',
    'It is suggested that the consortium expand its geographic reach.',
    'The proposal would be strengthened by a clearer risk register.',
    'Providing named deliverables could clarify the timeline.',
    'There is scope to broaden the exploitation plan.',
    'More quantitative evidence would be welcome.',
  ]

  for (const sentence of mustFlag) {
    test(`flags: "${sentence.slice(0, 60)}…"`, () => {
      const r = qualityGuard(sentence, 3.0)
      expect(r.flags.length, `Expected flag for: "${sentence}"`).toBeGreaterThan(0)
    })
  }
})

// ─── Must NOT flag (neutral factual statements) ───────────────────────────────

describe('Soft-rec regex — must NOT flag neutral statements:', () => {
  const mustPass = [
    'The methodology is sound and well-aligned with TRL 6 ambitions.',
    'The consortium comprises eight partners across four Member States.',
    'Evidence in §2.2 demonstrates a fully costed Gantt chart.',
    'A normal-severity shortcoming is the absence of a named data steward.',
    'The DNSH self-assessment is incomplete in the submitted text.',
    'The work plan contains 12 work packages with clear deliverables.',
    'No risk register is present in the submitted Part B.',
    'The dissemination plan is brief and lacks quantified reach targets.',
    'EMPA leads WP3; FEUP and CNRS contribute to WP4.',
  ]

  for (const sentence of mustPass) {
    test(`passes: "${sentence.slice(0, 60)}…"`, () => {
      const r = qualityGuard(sentence, 3.5)
      expect(r.flags, `Unexpected flag for: "${sentence}"`).toHaveLength(0)
    })
  }
})

// ─── Sentence-level drop (Option B) ──────────────────────────────────────────

describe('Sentence drop — removes offending sentences, keeps clean ones', () => {
  test('drops the forbidden sentence, preserves the clean one', () => {
    const text = 'The consortium is strong. The proposal could benefit from a wider partner network. The work plan is well-structured.'
    const r = qualityGuard(text, 3.5)
    expect(r.flags.length).toBeGreaterThan(0)
    expect(r.clean).toContain('The consortium is strong')
    expect(r.clean).toContain('The work plan is well-structured')
    expect(r.clean).not.toMatch(/could benefit/i)
  })

  test('does not leave [redacted] artefacts', () => {
    const text = 'The plan could be strengthened with milestones. Objectives are clear.'
    const r = qualityGuard(text, 3.5)
    expect(r.clean).not.toContain('[redacted]')
  })
})

// ─── Aspect sanitiser closes the leak path ───────────────────────────────────

describe('sanitiseAspect closes the aspect-text leak path', () => {
  test('strips soft-rec from aspect.strengths', () => {
    const asp = {
      aspectId: 'IMPL-1',
      strengths: [
        'The work plan is well-structured.',
        'Adding KPIs to WP3 would improve traceability.',
      ],
      shortcomings: [],
      evidencePointers: ['§2.1'],
    }
    const r = sanitiseAspect(asp, 3.5)
    expect(r.flags.length).toBeGreaterThan(0)
    expect(r.aspect.strengths!.join(' ')).not.toMatch(/would improve/i)
    expect(r.aspect.strengths!.join(' ')).not.toContain('[redacted]')
  })

  test('strips soft-rec from aspect.shortcomings.text', () => {
    const asp = {
      aspectId: 'IMPL-1',
      strengths: ['Sound consortium.'],
      shortcomings: [{
        severity: 'normal',
        // entire text is a soft-rec sentence — gets dropped → shortcoming removed
        text: 'The proposal could benefit from a wider geographic spread.',
      }],
      evidencePointers: ['§3'],
    }
    const r = sanitiseAspect(asp, 3.0)
    expect(r.flags.length).toBeGreaterThan(0)
    const allText = r.aspect.shortcomings!.map(sc => sc.text).join(' ')
    expect(allText).not.toMatch(/could benefit/i)
    expect(allText).not.toContain('[redacted]')
  })

  test('preserves clean aspect text unchanged', () => {
    const asp = {
      aspectId: 'EX-1',
      strengths: ['Objectives are clearly stated and pertinent to the call.'],
      shortcomings: [{ severity: 'minor', text: 'No explicit gender-dimension treatment in §1.2.' }],
      evidencePointers: ['§1.2'],
    }
    const r = sanitiseAspect(asp, 4.0)
    expect(r.flags).toHaveLength(0)
    expect(r.aspect.strengths![0]).toBe(asp.strengths[0])
    expect(r.aspect.shortcomings![0].text).toBe(asp.shortcomings[0].text)
  })

  test('removes shortcoming entry if text is entirely wiped by drop', () => {
    const asp = {
      aspectId: 'EX-2',
      strengths: ['Methodology is sound.'],
      shortcomings: [{ severity: 'normal', text: 'The work plan could be strengthened with a risk register.' }],
      evidencePointers: ['§2.1'],
    }
    const r = sanitiseAspect(asp, 3.5)
    // The shortcoming text should be empty after dropping → filtered out
    expect(r.aspect.shortcomings!.every(sc => sc.text.trim().length > 0)).toBe(true)
  })
})
