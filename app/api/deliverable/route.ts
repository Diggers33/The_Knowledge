/**
 * IRIS KB — Deliverable Writer Route
 *
 * POST { section, projectCode, wpNumber, deliverableRef, deliverableTitle, additionalContext, outputType? }
 *   → streams text/plain  (generation)
 *   → returns DOCX binary (outputType: 'docx')
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import { embed, rerankChunks, searchChunks, fetchSummariesByDimension } from '@/lib/iris-kb'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK = '0A2E36'
const IRIS_CYAN = '00C4D4'

// ─── STYLE ENFORCEMENT ────────────────────────────────────────────────────────

const STYLE_ENFORCEMENT = `
VOICE:
Write in past tense for completed work ("we developed", "we demonstrated", "the system achieved").
Write in present tense for current state ("the prototype operates at", "the model classifies").
Use first person plural: "we", "our", "the team".

EVIDENCE:
Always pair claims with measurements. Never assert without a number.
Wrong: "The system showed good accuracy."
Right: "The system achieved 94.7% classification accuracy (F1 = 0.93) on the validation dataset of 847 samples."

STRUCTURE:
Short declarative result → supporting evidence → significance.
Reference WP and deliverable numbers where relevant: "As described in D3.1...", "Within WP2..."

FORBIDDEN: "it is worth noting", "it should be highlighted", "as can be seen", "needless to say",
"it is important to mention", "state-of-the-art" as adjective, "transformative", "holistic".
`

// ─── SECTION CONFIGS ──────────────────────────────────────────────────────────

const SECTION_CONFIGS: Record<string, {
  label: string
  summaryDims: string[]
  seeds: string[]
  systemPrompt: string
  wordTarget: number
}> = {
  executive_summary: {
    label: 'Executive Summary',
    summaryDims: ['iris_results', 'iris_role'],
    seeds: [
      'IRIS deliverable summary objective scope results achieved',
      'work package deliverable month outcomes progress',
    ],
    systemPrompt: `Write the executive summary for this deliverable. Cover: (1) the objective and scope of this deliverable, (2) the methods or approach used, (3) the key results and outcomes achieved, (4) status against plan. Be specific — name the WP, deliverable reference, and any key metrics. 2–3 paragraphs.`,
    wordTarget: 300,
  },
  technical_results: {
    label: 'Technical Results',
    summaryDims: ['iris_results', 'iris_technology', 'iris_validation'],
    seeds: [
      'IRIS NIR Raman spectroscopy results accuracy prototype performance',
      'measurement calibration validation dataset accuracy RMSE R2 TRL',
    ],
    systemPrompt: `Write the technical results section. Present the specific outcomes achieved: measurements taken, models built, accuracy figures, TRL advancement. Use subsections if needed. Every claim must be supported by a specific figure, percentage, or reference. Do not write in future tense.`,
    wordTarget: 600,
  },
  iris_contribution: {
    label: 'IRIS Contribution',
    summaryDims: ['iris_role', 'iris_technology', 'iris_results'],
    seeds: [
      'IRIS task lead developed built demonstrated NIR sensor spectroscopy',
      'IRIS contribution work package responsibility deliverable result',
    ],
    systemPrompt: `Write the IRIS Technology Solutions contribution section. Describe specifically: which tasks IRIS led, what IRIS developed or built, what results IRIS achieved, and how IRIS's contribution fits within the broader WP. Name specific technologies (NIR, Raman, hyperspectral, chemometrics) where relevant. Write in past tense.`,
    wordTarget: 400,
  },
  methodology: {
    label: 'Methodology',
    summaryDims: ['iris_technology'],
    seeds: [
      'IRIS experimental approach measurement protocol calibration NIR Raman',
      'sample preparation data collection analysis workflow procedure',
    ],
    systemPrompt: `Write the methodology section describing how the work was carried out. Cover: experimental setup, instruments used, data collection procedure, analysis approach, and any standards or protocols followed. Be specific about instrument specifications, sample sizes, and analytical methods. Write in past tense.`,
    wordTarget: 500,
  },
  conclusions: {
    label: 'Conclusions and Next Steps',
    summaryDims: ['iris_results', 'iris_validation'],
    seeds: [
      'IRIS conclusions findings lessons learned next steps recommendations',
      'achieved demonstrated validated TRL advancement future work',
    ],
    systemPrompt: `Write the conclusions and next steps section. Summarise the key findings of this deliverable, compare outcomes against the targets set in the DoA, identify any challenges encountered and how they were addressed, and outline the next steps for the following period. Close with the TRL status if relevant.`,
    wordTarget: 400,
  },
  validation: {
    label: 'Validation and KPIs',
    summaryDims: ['iris_validation', 'iris_results'],
    seeds: [
      'IRIS validation pilot test KPI performance target benchmark industrial',
      'validation dataset test accuracy target met exceeded threshold',
    ],
    systemPrompt: `Write the validation and KPI assessment section. For each key performance indicator defined in the DoA, state: the target, the result achieved, whether the target was met, and any deviations with explanation. Include pilot or demonstration results where applicable. Use a structured format: KPI → Target → Result → Status.`,
    wordTarget: 500,
  },
}

// ─── CONTEXT RETRIEVAL ────────────────────────────────────────────────────────

async function getDeliverableContext(
  section: string,
  projectCode: string,
  wpNumber: string,
  deliverableTitle: string,
  additionalContext: string
): Promise<{ chunks: string; summaries: string }> {
  const cfg = SECTION_CONFIGS[section]
  if (!cfg) return { chunks: '', summaries: '' }

  const queryText = `${deliverableTitle} ${wpNumber} ${cfg.seeds[0]}`

  // Embed and retrieve relevant chunks
  const embedding = await embed(queryText)
  const rawChunks = await searchChunks(embedding, queryText, 20, [projectCode])
  const reranked = rawChunks.length > 0
    ? (await rerankChunks(`${section} ${deliverableTitle}`, rawChunks)).slice(0, 8)
    : rawChunks.slice(0, 8)

  const chunks = reranked.map((c, i) =>
    `[${i + 1}] (${c.project_tag}) ${c.chunk_text}`
  ).join('\n\n')

  // Fetch project summaries for relevant dimensions
  const allSummaries = await fetchSummariesByDimension(cfg.summaryDims)
  const projectSummary = allSummaries.find(p => p.project_code.toUpperCase() === projectCode.toUpperCase())
  const summaries = projectSummary
    ? cfg.summaryDims
        .map(dim => projectSummary.dimensions[dim] ? `**${dim}**: ${projectSummary.dimensions[dim]}` : '')
        .filter(Boolean)
        .join('\n\n')
    : ''

  return { chunks, summaries }
}

// ─── DOCX BUILDER ─────────────────────────────────────────────────────────────

async function buildDeliverableDocx(
  sections: Record<string, string>,
  projectCode: string,
  deliverableRef: string,
  deliverableTitle: string,
  wpNumber: string
): Buffer {
  const children: Paragraph[] = []

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: `${deliverableRef}: ${deliverableTitle}`, bold: true, size: 36, color: IRIS_DARK })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 },
  }))

  // Metadata line
  children.push(new Paragraph({
    children: [new TextRun({ text: `Project: ${projectCode}   |   Work Package: ${wpNumber}`, size: 20, color: '666666' })],
    spacing: { after: 400 },
  }))

  const sectionOrder = ['executive_summary', 'methodology', 'technical_results', 'iris_contribution', 'validation', 'conclusions']

  for (const sectionId of sectionOrder) {
    if (!sections[sectionId]) continue
    const cfg = SECTION_CONFIGS[sectionId]

    children.push(new Paragraph({
      children: [new TextRun({ text: cfg.label, bold: true, size: 28, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: 'single' } },
    }))

    const paragraphs = sections[sectionId].split('\n\n').filter(p => p.trim())
    for (const para of paragraphs) {
      children.push(new Paragraph({
        children: [new TextRun({ text: para.trim(), size: 22 })],
        spacing: { after: 160 },
        alignment: AlignmentType.JUSTIFIED,
      }))
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBuffer(doc)
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    section,
    projectCode,
    wpNumber = 'WP1',
    deliverableRef = 'D1.1',
    deliverableTitle = '',
    additionalContext = '',
    outputType,
    generatedSections,
  } = body

  // DOCX export path
  if (outputType === 'docx' && generatedSections) {
    try {
      const buffer = await buildDeliverableDocx(generatedSections, projectCode, deliverableRef, deliverableTitle, wpNumber)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${projectCode}_${deliverableRef.replace('.', '-')}.docx"`,
        },
      })
    } catch (e) {
      return NextResponse.json({ error: 'DOCX generation failed' }, { status: 500 })
    }
  }

  // Generation path
  if (!section || !projectCode) {
    return NextResponse.json({ error: 'section and projectCode required' }, { status: 400 })
  }

  const cfg = SECTION_CONFIGS[section]
  if (!cfg) {
    return NextResponse.json({ error: `Unknown section: ${section}` }, { status: 400 })
  }

  try {
    const { chunks, summaries } = await getDeliverableContext(
      section, projectCode, wpNumber, deliverableTitle, additionalContext
    )

    const systemPrompt = [
      `You are an expert EU Horizon Europe deliverable writer for IRIS Technology Solutions — a photonics and NIR spectroscopy SME in Barcelona.`,
      STYLE_ENFORCEMENT,
      `\n## Deliverable Context\nProject: ${projectCode}\nWork Package: ${wpNumber}\nDeliverable: ${deliverableRef} — ${deliverableTitle}`,
      summaries ? `\n## Project Summary (from IRIS knowledge base)\n${summaries}` : '',
      chunks ? `\n## Relevant Document Chunks\n${chunks}` : '',
      additionalContext ? `\n## Additional Context Provided\n${additionalContext}` : '',
      `\n## Your Task\n${cfg.systemPrompt}`,
      `\nTarget length: approximately ${cfg.wordTarget} words.`,
    ].filter(Boolean).join('\n')

    const model = process.env.IRIS_DELIVERABLE_MODEL || process.env.IRIS_PROPOSAL_MODEL || 'gpt-4o'

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: systemPrompt }],
      temperature: 0.4,
      max_tokens: 2000,
      stream: true,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) controller.enqueue(encoder.encode(text))
        }
        controller.close()
      },
    })

    return new NextResponse(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Accel-Buffering': 'no' },
    })
  } catch (e: any) {
    console.error('Deliverable generation error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
