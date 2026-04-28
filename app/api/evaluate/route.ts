import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'
import { getAspects } from '@/lib/evaluator/criteria'
import { evaluateThresholds, SCORE_RUBRIC } from '@/lib/evaluator/rubric'
import { qualityGuard, sanitiseAspect, checkScoreCommentConsistency } from '@/lib/evaluator/quality-guard'
import { buildCallContextBlock, isTopicLoaded } from '@/lib/evaluator/call-topic'
import { enforceEvidenceFloor, aggregateAspectScores } from '@/lib/evaluator/scoring'
import { buildExemplarBlock } from '@/lib/evaluator/anchor-exemplars'
import { scoreIMPL1, scoreIMPL2 } from '@/lib/evaluator/evidence-density'
import { getProposal } from '@/lib/server/proposal-cache'
import type { ActionType, CriterionId } from '@/lib/evaluator/criteria'
import type { CallTopic } from '@/lib/evaluator/call-topic'
import type { AspectAssessment, ProposalDocument, FigurePage } from '@/lib/evaluator/types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK = '0A2E36'
const IRIS_CYAN = '00C4D4'

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

const ASPECT_SYSTEM_PROMPT = `You are an EU Horizon Europe expert evaluator assessing ONE specific aspect of a proposal.

Rules:
- State findings as observed facts. DO NOT make recommendations.
- DO NOT use: "you should", "could benefit from", "could be strengthened", "would benefit from", "could enhance", "opportunity to improve", "consider adding", "the authors should".
- DO NOT compare to other proposals.
- DO NOT invent names, organisations, or figures not present in the text.

SCORE ANCHORS (for aspectScore):
5.0 — All evidence requirements met, multiple specific quantitative claims with section refs, no shortcomings beyond minor wording.
4.5 — As 5.0 but one minor shortcoming.
4.0 — Evidence is specific and credible; at most one normal-severity shortcoming.
3.5 — Evidence is present but includes one normal-severity shortcoming AND the aspect demonstrably exceeds "Good" on at least one sub-element. Do NOT default to 3.5.
3.0 — Aspect addressed but with multiple shortcomings, or evidence is mostly qualitative without quantification.
2.5 — Key evidence is missing or treatment is generic.
2.0 — Significant weaknesses; aspect addressed in name only.
1.5 — Between Poor and Fair.
1.0 — Serious inherent weakness; proposal would likely fail this aspect.
0.5 — Marginal acknowledgement only.
0.0 — Aspect not addressed at all.

EVIDENCE FLOOR (mandatory before setting aspectScore):
- score ≥ 4.0: requires ≥2 evidencePointers AND ≥2 strengths AND ≤1 normal-severity shortcoming
- score ≥ 3.0: requires ≥1 evidencePointer AND ≥1 strength
- score < 5.0: requires ≥1 shortcoming entry (any severity)
- score < 3.0: requires ≥1 normal-or-significant shortcoming

Shortcoming severity:
- minor: marginal, easily rectified
- normal: important, impacts scoring but proposal remains fundable
- significant: limited/ineffective treatment; pushes score below threshold

Return ONLY valid JSON:
{
  "aspectId": "EX-1",
  "evidencePointers": ["§1.1", "§2.2"],
  "strengths": ["..."],
  "shortcomings": [{ "severity": "minor|normal|significant", "text": "..." }],
  "topicAnchor": "EO1, EO3",
  "aspectScore": 3.0,
  "scoreJustification": "1–2 sentence explanation citing specific evidence from the text"
}`

const SYNTHESIS_SYSTEM_PROMPT = `You are writing the narrative comment for an EU Horizon Europe Evaluation Summary Report.

Rules:
- 200–400 words. One or two paragraphs.
- State facts observed in the proposal. DO NOT make recommendations.
- DO NOT use: "could benefit from", "would benefit from", "could be strengthened", "should consider", "opportunity to improve".
- Tone must match the score: a score of 4+ warrants a predominantly positive narrative; a score below 3 warrants a predominantly critical narrative.
- Cite section references where relevant.

Return ONLY valid JSON: { "comment": "..." }`

// ─── IER MODE ─────────────────────────────────────────────────────────────────

interface IERRequest {
  mode: 'ier'
  proposalText: string
  proposal?: ProposalDocument
  docId?: string
  criterion: CriterionId
  actionType: ActionType
  post2026: boolean
  thresholds: { individual: number; total: number }
  consortiumPartners: string[]
  sshRequired?: boolean
  aiRequired?: boolean
  dnshRequired?: boolean
  callTopic?: CallTopic
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

function buildAspectUserPrompt(
  aspectId: string,
  aspectText: string,
  criterion: string,
  actionType: string,
  post2026: boolean,
  proposalText: string,
  callContextBlock: string,
  withTopicAnchor: boolean,
): string {
  const exemplarBlock = buildExemplarBlock(aspectId)
  return `Criterion: ${criterion.toUpperCase()}
Action type: ${actionType}
Work programme: ${post2026 ? '2026 and later' : 'Pre-2026'}
${callContextBlock}
ASPECT TO ASSESS:
${aspectId}: ${aspectText}

${exemplarBlock}

PROPOSAL TEXT:
${proposalText}

Assess ONLY the aspect above. ${withTopicAnchor ? 'Populate topicAnchor with Expected Outcome labels (EO1, EO2…) this aspect addresses.' : 'Set topicAnchor to empty string.'}
Return ONLY valid JSON as specified.`
}

function buildAspectMessageContent(
  aspectId: string,
  aspectText: string,
  criterion: string,
  actionType: string,
  post2026: boolean,
  proposal: ProposalDocument | null,
  textSlice: string,
  callContextBlock: string,
  withTopicAnchor: boolean,
): ContentPart[] {
  const parts: ContentPart[] = []

  const textBlock = buildAspectUserPrompt(aspectId, aspectText, criterion, actionType, post2026, textSlice, callContextBlock, withTopicAnchor)
  parts.push({ type: 'text', text: textBlock })

  if (proposal && proposal.tables.length > 0) {
    const relevantKinds: Record<string, string[]> = {
      'IMPL-1': ['wp_summary', 'deliverable', 'milestone', 'risk', 'kpi'],
      'IMPL-2': ['partner'],
      'IMPL-3': ['budget'],
      'IM-1':   ['kpi'],
    }
    const wanted = relevantKinds[aspectId] ?? []
    const tablesForAspect = proposal.tables.filter(t => wanted.length === 0 || wanted.includes(t.kind))
    if (tablesForAspect.length > 0) {
      const tablesJson = tablesForAspect.map(t => ({
        kind: t.kind,
        page: t.pageNumber,
        header: t.header,
        rows: t.rows.map(r => r.cells),
      }))
      parts.push({
        type: 'text',
        text: `\n\n--- STRUCTURED TABLES (extracted from PDF) ---\n${JSON.stringify(tablesJson, null, 2)}`,
      })
    }
  }

  if (proposal && proposal.figures.length > 0) {
    const aspectFigureHints: Record<string, FigurePage['hint'][]> = {
      'IMPL-1': ['gantt', 'pert', 'flow'],
      'IMPL-2': ['flow', 'architecture'],
      'EX-1':   ['architecture', 'flow'],
      'EX-2':   ['flow'],
      'IM-2':   ['flow', 'architecture'],
    }
    const wantedHints = aspectFigureHints[aspectId] ?? []
    if (wantedHints.length > 0) {
      const relevantFigs = proposal.figures.filter(f => wantedHints.includes(f.hint)).slice(0, 3)
      for (const fig of relevantFigs) {
        parts.push({
          type: 'image_url',
          image_url: { url: fig.dataUrl, detail: 'high' },
        })
      }
    }
  }

  return parts
}

async function buildSynthesisComment(
  aspects: AspectAssessment[],
  aggregatedScore: number,
  criterion: string,
  callTopic: CallTopic | undefined,
): Promise<string> {
  const aspectSummary = aspects.map(a =>
    `${a.aspectId} (score ${a.aspectScore}): ${a.scoreJustification}\n  Strengths: ${a.strengths.join('; ')}\n  Shortcomings: ${a.shortcomings.map(s => `[${s.severity}] ${s.text}`).join('; ')}`
  ).join('\n\n')

  const topicNote = callTopic && isTopicLoaded(callTopic) && callTopic.expectedOutcomes.length > 0
    ? `\nCall expected outcomes: ${callTopic.expectedOutcomes.map((o, i) => `EO${i + 1}: ${o}`).join('; ')}`
    : ''

  const userPrompt = `Write a 200–400 word narrative comment for the ${criterion.toUpperCase()} criterion.
Aggregated score: ${aggregatedScore}/5
${topicNote}

Per-aspect findings:
${aspectSummary}

Return ONLY valid JSON: { "comment": "..." }`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}')
    return parsed.comment || ''
  } catch {
    return aspects.map(a => a.scoreJustification).join(' ')
  }
}

async function handleIER(body: IERRequest) {
  const { docId, proposal: legacyProposal, proposalText, criterion, actionType, post2026, callTopic } = body

  // Resolve ProposalDocument: prefer docId → cache, fallback to direct payload
  let proposal: ProposalDocument | null = null
  if (docId) {
    proposal = await getProposal(docId)
    if (!proposal) {
      return NextResponse.json(
        { error: 'cache_miss', message: 'Proposal cache expired. Please re-upload to continue.' },
        { status: 410 },
      )
    }
  } else if (legacyProposal) {
    proposal = legacyProposal
  }

  const aspects = getAspects(actionType, post2026).filter(a => a.criterion === criterion)
  const callContextBlock = callTopic && isTopicLoaded(callTopic)
    ? `\n${buildCallContextBlock(callTopic)}\n`
    : ''
  const withTopicAnchor = !!(callTopic && isTopicLoaded(callTopic))
  const textSlice = proposalText.slice(0, 18000)

  // ── Per-aspect parallel calls ────────────────────────────────────────────────
  const rawAssessments = await Promise.all(
    aspects.map(async (aspect) => {
      const content = buildAspectMessageContent(
        aspect.id, aspect.text, criterion, actionType, post2026,
        proposal ?? null, textSlice, callContextBlock, withTopicAnchor,
      )
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: ASPECT_SYSTEM_PROMPT },
          { role: 'user', content: content as any },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      })
      try {
        const raw = JSON.parse(completion.choices[0]?.message?.content || '{}') as AspectAssessment
        return { ...raw, scoreSource: raw.scoreSource ?? 'judgement' }
      } catch {
        return { aspectId: aspect.id, evidencePointers: [], strengths: [], shortcomings: [], aspectScore: 0, scoreSource: 'judgement', scoreJustification: '' } as AspectAssessment
      }
    })
  )

  // ── Evidence-floor enforcement + aspect-text sanitisation via sanitiseAspect ──
  const aspectFlags: string[] = []
  const assessments: AspectAssessment[] = rawAssessments.map(a => {
    const flooredScore = enforceEvidenceFloor(a)
    const floored = { ...a, aspectScore: flooredScore }
    const { aspect: sanitised, flags } = sanitiseAspect(floored, flooredScore)
    aspectFlags.push(...flags)
    return sanitised as unknown as AspectAssessment
  })

  // ── Evidence-density override for countable aspects (IMPL-1, IMPL-2) ────────
  for (const asp of assessments) {
    if (asp.aspectId === 'IMPL-1') {
      const ed = scoreIMPL1(proposal ?? proposalText)
      asp.aspectScore = ed.bandedScore
      asp.scoreSource = 'computed'
      asp.evidenceDensitySignals = ed.signals
      asp.scoreJustification = `${ed.bandRationale} | Model notes: ${asp.scoreJustification}`
    } else if (asp.aspectId === 'IMPL-2') {
      const ed = scoreIMPL2(proposal ?? proposalText, body.consortiumPartners ?? [])
      asp.aspectScore = ed.bandedScore
      asp.scoreSource = 'computed'
      asp.evidenceDensitySignals = ed.signals
      asp.scoreJustification = `${ed.bandRationale} | Model notes: ${asp.scoreJustification}`
    }
  }

  // ── Aggregate score (weighted mean) ─────────────────────────────────────────
  const weights = aspects.map(a => a.weight ?? 1)
  const aggregatedScore = aggregateAspectScores(assessments, weights)

  // ── Synthesise narrative comment ─────────────────────────────────────────────
  const rawComment = await buildSynthesisComment(assessments, aggregatedScore, criterion, callTopic)
  const guardResult = qualityGuard(rawComment, aggregatedScore)

  // ── Consistency check ────────────────────────────────────────────────────────
  const consistency = checkScoreCommentConsistency(guardResult.clean, aggregatedScore, assessments)
  if (!consistency.ok) guardResult.flags.push(`score-comment inconsistency: ${consistency.reason}`)
  guardResult.flags.push(...aspectFlags)

  // ── Append EO anchor summary so textarea matches DOCX ───────────────────────
  const anchorLines = assessments
    .filter(a => a.topicAnchor?.trim())
    .map(a => `${a.aspectId}: ${a.topicAnchor!.trim()}`)
  const finalComment = anchorLines.length > 0
    ? `${guardResult.clean.trim()}\n\n[Outcomes addressed — ${anchorLines.join(' | ')}]`
    : guardResult.clean

  return NextResponse.json({
    aspects: assessments,
    score: aggregatedScore,
    comment: finalComment,
    flags: guardResult.flags,
    criterion,
  })
}

// ─── ESR DOCX MODE ────────────────────────────────────────────────────────────

interface CriterionData {
  criterion: string
  score: number
  comment: string
  aspects: Array<Partial<AspectAssessment> & { aspectId: string }>
}

interface AdditionalQuestionData {
  questionId: string
  answer: string
  justification: string
}

interface ESRDocxRequest {
  mode: 'esr_docx'
  proposalRef: string
  actionType: ActionType
  post2026: boolean
  thresholds: { individual: number; total: number }
  criteria: CriterionData[]
  additionalQuestions?: AdditionalQuestionData[]
  evaluatorIdentity?: string
  callTopic?: CallTopic
}

function getScoreLabel(score: number): string {
  const match = SCORE_RUBRIC.find(r => r.score === Math.round(score))
  return match?.label ?? '—'
}

async function buildESRDocx(body: ESRDocxRequest): Promise<Buffer> {
  // Defence-in-depth: re-sanitise aspects in case client edited textareas post-generation
  body.criteria = body.criteria.map(c => ({
    ...c,
    aspects: c.aspects.map(a => sanitiseAspect(a, c.score).aspect as typeof a),
  }))

  const {
    proposalRef, actionType, post2026, thresholds,
    criteria, additionalQuestions, evaluatorIdentity, callTopic,
  } = body

  const children: Array<Paragraph | Table> = []
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

  // ── Title page ──────────────────────────────────────────────────────────────

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Self-Assessment — Pre-submission Evaluation', bold: true, size: 40, color: IRIS_DARK })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 160 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Modelled on Horizon Europe expert evaluation criteria', size: 24, color: '555555' })],
    spacing: { after: 120 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({
      text: 'This is an internal IRIS self-assessment. It is not an EC evaluation and has no formal status.',
      italics: true, size: 20, color: '888888',
    })],
    spacing: { after: 200 },
  }))

  const metaPairs: Array<[string, string]> = [
    ['Proposal Reference', proposalRef],
    ['Action Type', actionType],
    ['Work Programme', post2026 ? '2026 and later' : 'Pre-2026'],
    ['Date', today],
  ]
  if (evaluatorIdentity) metaPairs.push(['Prepared by', evaluatorIdentity])

  for (const [key, value] of metaPairs) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${key}: `, bold: true, size: 22 }),
        new TextRun({ text: value, size: 22 }),
      ],
      spacing: { after: 80 },
    }))
  }

  children.push(new Paragraph({ spacing: { after: 400 } }))

  // ── Call Topic Context (if supplied) ─────────────────────────────────────────

  if (callTopic && isTopicLoaded(callTopic)) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Call / Topic Context', bold: true, size: 32, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 160 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    }))

    const topicMeta: Array<[string, string]> = []
    if (callTopic.topicId) topicMeta.push(['Topic ID', callTopic.topicId])
    if (callTopic.topicTitle) topicMeta.push(['Title', callTopic.topicTitle])
    if (callTopic.destination) topicMeta.push(['Destination', callTopic.destination])
    if (callTopic.cluster) topicMeta.push(['Cluster', callTopic.cluster])
    if (callTopic.partnership) topicMeta.push(['Partnership / Mission', callTopic.partnership])
    const cond = callTopic.specificConditions
    if (cond.trlAtStart !== null) topicMeta.push(['TRL at start', String(cond.trlAtStart)])
    if (cond.trlAtEnd !== null) topicMeta.push(['TRL at end', String(cond.trlAtEnd)])
    if (cond.durationMonths !== null) topicMeta.push(['Max duration', `${cond.durationMonths} months`])
    if (cond.indicativeBudget) topicMeta.push(['Indicative budget', cond.indicativeBudget])

    for (const [k, v] of topicMeta) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${k}: `, bold: true, size: 22 }), new TextRun({ text: v, size: 22 })],
        spacing: { after: 60 },
      }))
    }

    if (callTopic.expectedOutcomes.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Expected Outcomes', bold: true, size: 22 })],
        spacing: { before: 160, after: 80 },
      }))
      callTopic.expectedOutcomes.forEach((o, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: `EO${i + 1}. ${o}`, size: 20 })],
          spacing: { after: 60 },
        }))
      })
    }

    if (callTopic.scope.trim()) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Scope', bold: true, size: 22 })],
        spacing: { before: 160, after: 80 },
      }))
      children.push(new Paragraph({
        children: [new TextRun({ text: callTopic.scope.trim(), size: 20 })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120 },
      }))
    }

    children.push(new Paragraph({ spacing: { after: 200 } }))
  }

  // ── Per-criterion sections ───────────────────────────────────────────────────

  const thresholdInput = criteria.map(c => ({ criterion: c.criterion, score: c.score }))
  const thresholdResult = evaluateThresholds(thresholdInput, thresholds)

  for (const crit of criteria) {
    const label = crit.criterion.charAt(0).toUpperCase() + crit.criterion.slice(1)
    const scoreLabel = getScoreLabel(crit.score)
    const passes = crit.score >= thresholds.individual

    children.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 32, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 160 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    }))

    children.push(new Paragraph({
      children: [new TextRun({ text: `Score: ${crit.score} / 5 — ${scoreLabel}`, bold: true, size: 24 })],
      spacing: { after: 80 },
    }))

    children.push(new Paragraph({
      children: [new TextRun({
        text: passes
          ? `✓ Passes threshold (≥ ${thresholds.individual})`
          : `✗ Below threshold (${thresholds.individual})`,
        bold: true,
        size: 20,
        color: passes ? '16A34A' : 'DC2626',
      })],
      spacing: { after: 160 },
    }))

    // Comment
    if (crit.comment) {
      const paras = crit.comment.split('\n\n').filter(p => p.trim())
      for (const para of paras) {
        children.push(new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 22 })],
          spacing: { after: 120 },
          alignment: AlignmentType.JUSTIFIED,
        }))
      }
    }

    // Aspects
    if (crit.aspects && crit.aspects.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Aspect Assessment', bold: true, size: 24, color: IRIS_DARK })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }))

      for (const asp of crit.aspects) {
        const aspScoreText = (asp as AspectAssessment).aspectScore !== undefined
          ? ` — ${(asp as AspectAssessment).aspectScore.toFixed(1)} / 5`
          : ''
        children.push(new Paragraph({
          children: [new TextRun({ text: `${asp.aspectId}${aspScoreText}`, bold: true, size: 22 })],
          spacing: { before: 160, after: 40 },
        }))
        if ((asp as AspectAssessment).scoreJustification) {
          children.push(new Paragraph({
            children: [new TextRun({ text: (asp as AspectAssessment).scoreJustification, italics: true, size: 18, color: '555555' })],
            spacing: { after: 80 },
          }))
        }

        if (asp.strengths && asp.strengths.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'Strengths', bold: true, size: 20, color: '16A34A' })],
            spacing: { after: 60 },
          }))
          for (const s of asp.strengths) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `• ${s}`, size: 20 })],
              spacing: { after: 40 },
            }))
          }
        }

        if (asp.shortcomings && asp.shortcomings.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'Shortcomings', bold: true, size: 20, color: 'D97706' })],
            spacing: { before: 80, after: 60 },
          }))
          for (const sc of asp.shortcomings) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `• [${sc.severity}] ${sc.text}`, size: 20 })],
              spacing: { after: 40 },
            }))
          }
        }

        if (asp.evidencePointers && asp.evidencePointers.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Evidence: ${asp.evidencePointers.join(', ')}`, italics: true, size: 18, color: '888888' })],
            spacing: { after: 40 },
          }))
        }
        if (asp.topicAnchor) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Outcomes addressed: ${asp.topicAnchor}`, italics: true, size: 18, color: '0077AA' })],
            spacing: { after: 80 },
          }))
        }
      }
    }
  }

  // ── Threshold summary ────────────────────────────────────────────────────────

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Threshold Summary', bold: true, size: 32, color: IRIS_DARK })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
    border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
  }))

  children.push(new Paragraph({
    children: [new TextRun({ text: `Total Score: ${thresholdResult.totalScore} / ${criteria.length * 5}`, bold: true, size: 24 })],
    spacing: { after: 80 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({
      text: `Individual thresholds: ${thresholdResult.passesIndividual ? 'PASSED' : 'FAILED'}`,
      bold: true, size: 22,
      color: thresholdResult.passesIndividual ? '16A34A' : 'DC2626',
    })],
    spacing: { after: 80 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({
      text: `Total threshold: ${thresholdResult.passesTotal ? 'PASSED' : 'FAILED'}`,
      bold: true, size: 22,
      color: thresholdResult.passesTotal ? '16A34A' : 'DC2626',
    })],
    spacing: { after: 80 },
  }))

  if (thresholdResult.failures.length > 0) {
    for (const f of thresholdResult.failures) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `• ${f}`, size: 20, color: 'DC2626' })],
        spacing: { after: 40 },
      }))
    }
  }

  // ── Additional questions ─────────────────────────────────────────────────────

  if (additionalQuestions && additionalQuestions.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Additional Questions', bold: true, size: 32, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    }))

    const headerRow = new TableRow({
      children: ['Question', 'Answer', 'Justification'].map(h =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
        })
      ),
      tableHeader: true,
    })

    const dataRows = additionalQuestions.map(q =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: q.questionId, size: 18 })] })],
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: q.answer, size: 18 })] })],
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: q.justification, size: 18 })] })],
            width: { size: 55, type: WidthType.PERCENTAGE },
          }),
        ],
      })
    )

    children.push(new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }))
  }

  // ── AI footer ────────────────────────────────────────────────────────────────

  children.push(new Paragraph({
    children: [new TextRun({
      text: 'This evaluation was produced with AI-assisted analysis (IRIS Knowledge Base). All scores and comments must be reviewed and validated by IRIS staff before use.',
      italics: true, size: 18, color: '888888',
    })],
    spacing: { before: 400 },
  }))

  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBuffer(doc)
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (body.mode === 'ier') {
    try {
      return await handleIER(body as IERRequest)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  if (body.mode === 'esr_docx') {
    try {
      const buffer = await buildESRDocx(body as ESRDocxRequest)
      const proposalRef = (body as ESRDocxRequest).proposalRef || 'evaluation'
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${proposalRef}_evaluation.docx"`,
        },
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid mode. Use "ier" or "esr_docx".' }, { status: 400 })
}

