import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'
import { getAspects } from '@/lib/evaluator/criteria'
import { evaluateThresholds, SCORE_RUBRIC } from '@/lib/evaluator/rubric'
import { qualityGuard } from '@/lib/evaluator/quality-guard'
import { buildCallContextBlock, isTopicLoaded } from '@/lib/evaluator/call-topic'
import type { ActionType, CriterionId } from '@/lib/evaluator/criteria'
import type { CallTopic } from '@/lib/evaluator/call-topic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK = '0A2E36'
const IRIS_CYAN = '00C4D4'

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const EC_SYSTEM_PROMPT = `You are an EU Horizon Europe expert evaluator assessing a single criterion of a single proposal under Horizon Europe rules.

Your output MUST follow the EC Quality Standard for Evaluation Summary Reports:
- Reflect strengths and weaknesses fairly.
- DO NOT make recommendations (no "you should...", "consider adding...", "the proposal would benefit from...").
- DO NOT make comparative statements.
- DO NOT include unverified categorical statements.
- The comment MUST be consistent with the score awarded.

Score rubric (mandatory):
0 — fails to address or cannot be assessed
1 — Poor (serious inherent weaknesses)
2 — Fair (significant weaknesses)
3 — Good (a number of shortcomings)
4 — Very Good (a small number of shortcomings)
5 — Excellent (any shortcomings are minor)

Use 0.5 steps. Use the whole range 0–5.

Shortcoming severity:
- Minor shortcoming: marginal aspect, easily rectified.
- Shortcoming: important aspect, impacts scoring but proposal remains fundable.
- Significant weakness: limited/ineffective treatment; pushes score below threshold.

If a specific number, person, or organisation is not present in the proposal text, do not invent one.

Return ONLY valid JSON with this structure:
{
  "aspects": [
    {
      "aspectId": "EX-1",
      "evidencePointers": ["§1.1", "§2.2"],
      "strengths": ["strength text"],
      "shortcomings": [{ "severity": "minor|normal|significant", "text": "shortcoming text" }],
      "topicAnchor": "EO1, EO3"
    }
  ],
  "score": 3.5,
  "comment": "200–400 word narrative paragraph"
}

The topicAnchor field is a comma-separated list of Expected Outcome references (e.g. "EO1, EO2") addressed by this aspect. Omit or leave empty string if no call topic was provided.`

// ─── IER MODE ─────────────────────────────────────────────────────────────────

interface IERRequest {
  mode: 'ier'
  proposalText: string
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

async function handleIER(body: IERRequest) {
  const { proposalText, criterion, actionType, post2026, callTopic } = body

  const aspects = getAspects(actionType, post2026).filter(a => a.criterion === criterion)

  const aspectList = aspects.map(a => `- ${a.id}: ${a.text}`).join('\n')

  const callContextBlock = callTopic && isTopicLoaded(callTopic)
    ? `\n\n${buildCallContextBlock(callTopic)}\n`
    : ''

  const userPrompt = `You are evaluating the "${criterion.toUpperCase()}" criterion of the following Horizon Europe proposal.

Action type: ${actionType}
Work programme: ${post2026 ? '2026 and later' : 'Pre-2026'}
${callContextBlock}
Aspects to assess for this criterion:
${aspectList}

PROPOSAL TEXT (excerpt):
${proposalText}

Assess each aspect listed above. For each aspect provide evidence pointers (section references), strengths, and shortcomings with severity.${callContextBlock ? ' Also populate topicAnchor with any Expected Outcome labels (EO1, EO2…) this aspect addresses.' : ''}
Then provide an overall score (0–5, 0.5 steps) and a 200–400 word narrative comment for this criterion.

Return ONLY valid JSON as specified.`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: EC_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const raw = completion.choices[0]?.message?.content || '{}'
  let parsed: { aspects: unknown[]; score: number; comment: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON from model' }, { status: 500 })
  }

  const guardResult = qualityGuard(parsed.comment || '', parsed.score || 0)

  return NextResponse.json({
    aspects: parsed.aspects,
    score: parsed.score,
    comment: guardResult.clean,
    flags: guardResult.flags,
    criterion,
  })
}

// ─── ESR DOCX MODE ────────────────────────────────────────────────────────────

interface CriterionData {
  criterion: string
  score: number
  comment: string
  aspects: Array<{
    aspectId: string
    evidencePointers?: string[]
    strengths?: string[]
    shortcomings?: Array<{ severity: string; text: string }>
    topicAnchor?: string
  }>
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
        children.push(new Paragraph({
          children: [new TextRun({ text: asp.aspectId, bold: true, size: 22 })],
          spacing: { before: 160, after: 80 },
        }))

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

