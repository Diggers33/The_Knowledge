export type QuestionId = 'scope' | 'exceptional_funding' | 'hESC' | 'hE' | 'not_eligible' | 'civil_only' | 'DNSH' | 'AI'

export interface AdditionalQuestion {
  id: QuestionId
  text: string
  guidance: string
  conditionalOn?: 'post2026_and_dnsh_flag' | 'post2026_and_ai_flag'
}

export const ADDITIONAL_QUESTIONS: AdditionalQuestion[] = [
  {
    id: 'scope',
    text: 'Is the proposal within the scope of the topic?',
    guidance: 'If No, the proposal must be excluded from evaluation.',
  },
  {
    id: 'exceptional_funding',
    text: 'Does the proposal request exceptional funding for third-country participants?',
    guidance: 'Flag for programme officer attention if Yes.',
  },
  {
    id: 'hESC',
    text: 'Does the proposal involve the use of human embryonic stem cells (hESC)?',
    guidance: 'If Yes, specific ethics conditions apply. Flag for ethics review.',
  },
  {
    id: 'hE',
    text: 'Does the proposal involve the use of human embryos?',
    guidance: 'If Yes, specific ethics conditions apply. Flag for ethics review.',
  },
  {
    id: 'not_eligible',
    text: 'Does the proposal include activities that are not eligible for funding (dual-use, weapons, activities banned in all Member States)?',
    guidance: 'If Yes, the proposal must be excluded.',
  },
  {
    id: 'civil_only',
    text: 'Is the proposal exclusively focused on civil applications?',
    guidance: 'If No, flag for programme officer attention.',
  },
  {
    id: 'DNSH',
    text: 'Does the proposal adequately address the Do No Significant Harm (DNSH) principle?',
    guidance: 'Only assess when required by the topic conditions.',
    conditionalOn: 'post2026_and_dnsh_flag',
  },
  {
    id: 'AI',
    text: 'Does the proposal address AI technical robustness requirements as part of Excellence?',
    guidance: 'Only assess when required by the topic conditions.',
    conditionalOn: 'post2026_and_ai_flag',
  },
]

export function getVisibleQuestions(post2026: boolean, dnshRequired: boolean, aiRequired: boolean): AdditionalQuestion[] {
  return ADDITIONAL_QUESTIONS.filter(q => {
    if (!q.conditionalOn) return true
    if (q.conditionalOn === 'post2026_and_dnsh_flag') return post2026 && dnshRequired
    if (q.conditionalOn === 'post2026_and_ai_flag') return post2026 && aiRequired
    return true
  })
}
