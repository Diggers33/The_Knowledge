/**
 * Server-side contamination filter for proposal generation.
 * Runs after model output and before saving to draft / writing to .docx.
 */

export type FilterVerdict = {
  ok: boolean
  hits: Array<{ rule: string; sample: string; count: number }>
  category: 'clean' | 'call_portal_scrape' | 'past_project' | 'prompt_leak' | 'self_reference' | 'corpus_exemplar'
}

// Full set of past-project names from the retrain corpus
export const CORPUS_PROJECT_NAMES = [
  'PRESERVE', 'PHOTONFOOD', 'SORT4CIRC', 'MICROORCH', 'GIANT LEAPS',
  'GRIDHEAL', 'CIRCSHOE', 'NANOBLOC', 'HYPERA', 'SecureFood',
]

// 1. Call-portal scrape canaries
const CALL_PORTAL_RULES: Array<[string, RegExp]> = [
  ['horizon_cl_callid_inline',         /HORIZON-[A-Z0-9]+-20\d{2}-[A-Z0-9-]{4,}/g],
  ['pdf_page_marker',                  /\bPage \d{1,3} of \d{1,3}\b/gi],
  ['call_template_objective_paren',    /\bObjective\(s\)\s*[:.]/g],
  ['call_template_expected_outcome',   /\bExpected Outcome\(s\)?\s*[:.]/g],
  ['call_template_destination',        /\bDestination\s*[—–-]\s*Twin Transition\b/gi],
  ['call_template_topic_id',           /\bTopic ID\s*[:.]/gi],
  ['scrape_horizon_office_ukraine',    /Horizon Europe Office in Ukraine/gi],
  ['scrape_call_opens_closes',         /The call opened on \w+ \d{1,2}, 20\d{2}/i],
  ['template_section_placeholder',     /\[(IMPACT|INNOVATION|EXCELLENCE|IMPLEMENTATION|OBJECTIVES|SOTA|METHODOLOGY|OUTCOMES|DISSEMINATION|WORKPLAN|MANAGEMENT|CONSORTIUM|BUSINESS_CASE)\]/g],
]

// 2. Past-project canaries — ALL known corpus project names
const PAST_PROJECT_RULES: Array<[string, RegExp]> = [
  ['past_grant_securefood',   /\bSecureFood\b/g],
  ['past_grant_microorch',    /\bMICROORCH\b/g],
  ['past_grant_giant_leaps',  /\bGIANT LEAPS\b/g],
  ['past_grant_gridheal',     /\bGRIDHEAL\b/g],
  ['past_grant_circshoe',     /\bCIRCSHOE\b/g],
  ['past_grant_nanobloc',     /\bNANOBLOC\b/g],
  ['past_grant_hypera',       /\bHYPERA\b/g],
  ['past_grant_preserve',     /\bPRESERVE\b/g],
  ['past_grant_photonfood',   /\bPHOTONFOOD\b/g],
  ['past_grant_sort4circ',    /\bSORT4CIRC\b/g],
  ['past_grant_number',       /\b101[0-9]{6}\b/g],
]

// 3. Prompt-leak canaries
const PROMPT_LEAK_RULES: Array<[string, RegExp]> = [
  ['prompt_role_preamble',         /You are an expert EU Horizon Europe proposal writer/i],
  ['prompt_iris_descriptor',       /photonics and NIR spectroscopy SME in Barcelona/i],
  ['prompt_iris_size',             /~?\s*60 staff\b/i],
  ['prompt_instruction_marker',    /Cross-reference where relevant\./i],
  ['prompt_negative_constraint',   /Do not repeat content already covered/i],
]

// 4. Self-reference / control-flow leakage (any in-body notice strings)
const SELF_REF_RULES: Array<[string, RegExp]> = [
  ['contam_truncated_notice',     /Section truncated: retrieved context contained/i],
  ['regenerate_directive_long',   /Please regenerate this section/i],
  ['regenerate_directive_short',  /Please regenerate\.\]\*/i],
  ['draft_truncated_notice',      /\*?\[Draft truncated[^\]]*\]\*?/gi],
  ['draft_incomplete_notice',     /\*?\[Draft incomplete[^\]]*\]\*?/gi],
  ['generation_degraded_notice',  /\*?\[Generation (?:quality degraded|contaminated)[^\]]*\]\*?/gi],
  ['retry_needed_marker',         /\*\[RETRY_NEEDED:/i],
  // Broader catch-all: any bracketed notice containing drift/regenerate/rejected keywords
  ['any_bracket_meta_notice',     /\*?\[[^\]]*(?:regenerate|drift|rejected|degraded|truncated|contaminated)[^\]]*\]\*?/gi],
  // Plain-text variants — workplan generation error, drift detector prose
  ['plain_please_regenerate',     /please\s+regenerate\b/gi],
  ['generation_error_notice',     /\bGeneration error:\s*[^\n.]+[.\n]/gi],
  ['drift_detector_prose',        /(?:drift detector|drifted off.topic|rejected by the drift|section was rejected)/gi],
]

// ── Corpus-exemplar narrator detection ───────────────────────────────────────
// Detects past project names used as narrating subjects (not citation-style).
// Pattern: NAME + (consortium|has|will|results…) OR "the NAME project" OR "In NAME,"
// Cite-style (as demonstrated in NAME / similar to NAME) is NOT flagged.

function buildNarratorRe(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(
    `\\b${esc}\\b\\s+(?:consortium|team|Project:|partners?|results?|approach|work|effort|deliverable|has\\b|have\\b|will\\b|is\\b|are\\b|was\\b|were\\b|achieved|developed|demonstrated|validated|disseminat|publish|present)` +
    `|the\\s+${esc}\\s+(?:project|consortium)\\b` +
    `|\\bIn\\s+${esc}[,\\s]` +
    `|\\bwithin\\s+${esc}\\b`,
    'gi'
  )
}

/**
 * Detect corpus-exemplar narration: past project name used as grammatical subject.
 * Returns hits if any past project (other than current acronym) appears as
 * narrating subject more than once. SoTA/innovation sections are exempted.
 */
function checkCorpusNarration(
  text: string,
  ctx: { acronym?: string; section?: string }
): FilterVerdict['hits'] {
  // SoTA citations are expected and legitimate
  const section = (ctx.section || '').toLowerCase()
  if (section.includes('sota') || section.includes('state_of_the_art') || section.includes('innovation')) return []

  const hits: FilterVerdict['hits'] = []
  for (const name of CORPUS_PROJECT_NAMES) {
    if (ctx.acronym && name.toUpperCase() === ctx.acronym.toUpperCase()) continue
    const re = buildNarratorRe(name)
    const matches = text.match(re) || []
    if (matches.length > 1) {
      hits.push({
        rule: `corpus_narrator_${name.toLowerCase().replace(/\s+/g, '_')}`,
        sample: (matches[0] ?? '').slice(0, 80),
        count: matches.length,
      })
    }
  }
  return hits
}

export function checkContamination(
  text: string,
  ctx: { acronym?: string; callId?: string; section?: string }
): FilterVerdict {
  const hits: FilterVerdict['hits'] = []
  let category: FilterVerdict['category'] = 'clean'

  const run = (rules: Array<[string, RegExp]>, cat: FilterVerdict['category']) => {
    for (const [rule, re] of rules) {
      // Allow the current project acronym to pass past-grant rules
      if (ctx.acronym && rule.startsWith('past_grant_') &&
          text.match(re)?.[0]?.toUpperCase() === ctx.acronym.toUpperCase()) continue

      // For call IDs: allow exactly one occurrence of the current callId (header), flag extras
      if (rule === 'horizon_cl_callid_inline' && ctx.callId) {
        const all = text.match(re) || []
        const others = all.filter(m => m !== ctx.callId)
        if (others.length > 0) hits.push({ rule, sample: others[0], count: others.length })
        const currentCount = all.filter(m => m === ctx.callId).length
        if (currentCount > 1) hits.push({ rule: 'horizon_cl_callid_repeated', sample: ctx.callId, count: currentCount })
        if (hits.some(h => h.rule === rule) && category === 'clean') category = cat
        continue
      }

      const m = text.match(re)
      if (m && m.length > 0) {
        hits.push({ rule, sample: m[0].slice(0, 80), count: m.length })
        if (category === 'clean') category = cat
      }
    }
  }

  run(CALL_PORTAL_RULES, 'call_portal_scrape')
  run(PAST_PROJECT_RULES, 'past_project')
  run(PROMPT_LEAK_RULES, 'prompt_leak')
  run(SELF_REF_RULES, 'self_reference')

  // Corpus-exemplar narration check (separate from PAST_PROJECT_RULES — different remediation)
  const narratorHits = checkCorpusNarration(text, ctx)
  if (narratorHits.length > 0) {
    hits.push(...narratorHits)
    if (category === 'clean') category = 'corpus_exemplar'
  }

  return { ok: hits.length === 0, hits, category }
}

/** Strip canaries in-place — used as last resort when retry budget exhausted. */
export function sanitiseInPlace(text: string): string {
  let out = text
  for (const [, re] of [...CALL_PORTAL_RULES, ...PROMPT_LEAK_RULES, ...SELF_REF_RULES]) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '')
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Replace corpus-exemplar narrating-subject occurrences with the current project acronym.
 * Preserves citation-style mentions ("as demonstrated in PRESERVE") by only matching
 * patterns where the past project name is followed by subject-indicative words.
 */
export function replaceCorpusNarrators(text: string, acronym: string): string {
  let out = text
  for (const name of CORPUS_PROJECT_NAMES) {
    if (name.toUpperCase() === acronym.toUpperCase()) continue
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

    // NAME + subject-indicative word → ACRONYM (keep the trailing word)
    out = out.replace(
      new RegExp(
        `\\b${esc}\\b(?=\\s+(?:consortium|team|Project:|partners?|results?|approach|work|effort|deliverable|has\\b|have\\b|will\\b|is\\b|are\\b|was\\b|were\\b|achieved|developed|demonstrated|validated|disseminat|publish|present))`,
        'gi'
      ),
      acronym
    )
    // "the NAME project/consortium" → "the ACRONYM project/consortium"
    out = out.replace(
      new RegExp(`\\bthe\\s+${esc}\\s+(?=project|consortium)`, 'gi'),
      `the ${acronym} `
    )
    // "In NAME," / "In NAME " → "In ACRONYM,"
    out = out.replace(
      new RegExp(`(\\bIn\\s+)${esc}(?=[,\\s])`, 'gi'),
      `$1${acronym}`
    )
    // "within NAME" → "within ACRONYM"
    out = out.replace(
      new RegExp(`(\\bwithin\\s+)${esc}\\b`, 'gi'),
      `$1${acronym}`
    )
  }
  return out
}
