/**
 * IRIS KB — Deliverable Writer Route
 *
 * POST { section, projectCode, wpNumber, deliverableRef, deliverableTitle, additionalContext, outputType? }
 *   → returns text/plain  (generation — buffered, guards applied)
 *   → returns DOCX binary (outputType: 'docx')
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'
import { embed, rerankChunks, searchChunks, fetchSummariesByDimension } from '@/lib/iris-kb'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const IRIS_DARK = '0A2E36'
const IRIS_CYAN = '00C4D4'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface KPI {
  id: string         // 'KPI-3.1'
  description: string
  target: string
  result: string
  status: 'met' | 'partial' | 'missed'
  notes?: string
}

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

const HALLUCINATION_GUARD = `\n\nIMPORTANT: If a specific number, person, or organisation is not present in the provided context, write [evidence required] rather than inventing one. Do not name collaborators outside the project consortium. Do not assert H-indices, patent counts, or career biographies.`

// ─── POST-GENERATION GUARDS ───────────────────────────────────────────────────

const PLACEHOLDER_REGEX = /\bXYZ\b|\bpartner\s+X\b|<INSERT|<TBD>|<PLACEHOLDER>|\[TBD\]|\[INSERT/gi

function stripPlaceholders(text: string): string {
  const found = text.match(PLACEHOLDER_REGEX)
  if (!found) return text
  return text.replace(PLACEHOLDER_REGEX, '[TBC]')
}

const FORBIDDEN_PHRASES: Array<[RegExp, string]> = [
  [/\bstate-of-the-art\b/gi,           'state of research'],
  [/\btransformative\b/gi,             'significant'],
  [/\bholistic\b/gi,                   'integrated'],
  [/\bit is worth noting\b/gi,         ''],
  [/\bit should be highlighted\b/gi,   ''],
  [/\bas can be seen\b/gi,             ''],
  [/\bneedless to say\b/gi,            ''],
  [/\bit is important to mention\b/gi, ''],
]

function scrubForbidden(text: string): string {
  let result = text
  for (const [re, replacement] of FORBIDDEN_PHRASES) result = result.replace(re, replacement)
  return result.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1')
}

function stripFabrications(text: string, allowedOrgs: string[]): string {
  // Strip Dr./Prof. + FullName patterns not in context
  text = text.replace(/\b(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g, '[name redacted]')
  // Strip H-index and patent count fabrications
  text = text.replace(/\bH-index\s+(?:of\s+)?\d+/gi, '')
  text = text.replace(/\b\d+\s+patents?\b/gi, '')
  return text
}

// ─── DYNAMIC FRAMING ─────────────────────────────────────────────────────────

async function buildIrisFraming(projectCode: string): Promise<string> {
  try {
    const summaries = await fetchSummariesByDimension(['iris_role', 'iris_technology'])
    const project = summaries.find(p => p.project_code.toUpperCase() === projectCode.toUpperCase())
    if (project) {
      const role = project.dimensions['iris_role'] || ''
      const tech = project.dimensions['iris_technology'] || ''
      if (role || tech) {
        return `You are an expert EU Horizon Europe deliverable writer for IRIS Technology Solutions, a Barcelona-based SME. In project ${projectCode} IRIS's role is: ${role}. The technologies IRIS contributes are: ${tech}. Stay strictly within this scope — do not introduce technologies, methods, or partners not present in the provided context.`
      }
    }
  } catch {
    // fall through to default
  }
  return `You are an expert EU Horizon Europe deliverable writer for IRIS Technology Solutions, a Barcelona-based SME.`
}

// ─── SEED BUILDER ────────────────────────────────────────────────────────────

function buildSeeds(section: string, projTechSummary: string, deliverableTitle: string): string[] {
  const tech = projTechSummary || 'project deliverable results work package'
  switch (section) {
    case 'executive_summary':
      return [
        `${tech} summary objective scope results achieved`,
        `${deliverableTitle} progress outcomes`,
      ]
    case 'technical_results':
      return [
        `${tech} measurements accuracy validation`,
        `${deliverableTitle} TRL prototype performance`,
      ]
    case 'iris_contribution':
      return [
        `IRIS task lead developed built demonstrated ${tech}`,
        `IRIS contribution work package responsibility`,
      ]
    case 'methodology':
      return [
        `${tech} experimental approach protocol`,
        `sample preparation data collection analysis workflow`,
      ]
    case 'validation':
      return [
        `${tech} validation pilot test KPI performance benchmark`,
        `validation dataset target met threshold`,
      ]
    case 'conclusions':
      return [
        `${tech} conclusions findings lessons learned next steps`,
        `achieved demonstrated TRL advancement future work`,
      ]
    default:
      return [`${tech} ${deliverableTitle}`, 'deliverable results work package']
  }
}

// ─── SECTION CONFIGS ──────────────────────────────────────────────────────────

const SECTION_CONFIGS: Record<string, {
  label: string
  summaryDims: string[]
  systemPrompt: string
  wordTarget: number
}> = {
  executive_summary: {
    label: 'Executive Summary',
    summaryDims: ['iris_results', 'iris_role'],
    systemPrompt: `Write the executive summary for this deliverable. Cover: (1) the objective and scope of this deliverable, (2) the methods or approach used, (3) the key results and outcomes achieved, (4) status against plan. Be specific — name the WP, deliverable reference, and any key metrics. 2–3 paragraphs.` + HALLUCINATION_GUARD,
    wordTarget: 300,
  },
  technical_results: {
    label: 'Technical Results',
    summaryDims: ['iris_results', 'iris_technology', 'iris_validation'],
    systemPrompt: `Write the technical results section. Present the specific outcomes achieved: measurements taken, models built, accuracy figures, TRL advancement. Use subsections if needed. Every claim must be supported by a specific figure, percentage, or reference. Do not write in future tense.` + HALLUCINATION_GUARD,
    wordTarget: 600,
  },
  iris_contribution: {
    label: 'IRIS Contribution',
    summaryDims: ['iris_role', 'iris_technology', 'iris_results'],
    systemPrompt: `Write the IRIS Technology Solutions contribution section. Describe specifically: which tasks IRIS led, what IRIS developed or built, what results IRIS achieved, and how IRIS's contribution fits within the broader WP. Name specific technologies (NIR, Raman, hyperspectral, chemometrics) where relevant. Write in past tense.` + HALLUCINATION_GUARD,
    wordTarget: 400,
  },
  methodology: {
    label: 'Methodology',
    summaryDims: ['iris_technology'],
    systemPrompt: `Write the methodology section describing how the work was carried out. Cover: experimental setup, instruments used, data collection procedure, analysis approach, and any standards or protocols followed. Be specific about instrument specifications, sample sizes, and analytical methods. Write in past tense.` + HALLUCINATION_GUARD,
    wordTarget: 500,
  },
  conclusions: {
    label: 'Conclusions and Next Steps',
    summaryDims: ['iris_results', 'iris_validation'],
    systemPrompt: `Write the conclusions and next steps section. Summarise the key findings of this deliverable, compare outcomes against the targets set in the DoA, identify any challenges encountered and how they were addressed, and outline the next steps for the following period. Close with the TRL status if relevant.` + HALLUCINATION_GUARD + `\n\nFor each acceptance criterion listed in the ACCEPTANCE CRITERIA section of the context (if provided), state in one sentence the specific evidence demonstrating it has been met, and reference the section or annex where that evidence lives.`,
    wordTarget: 400,
  },
  validation: {
    label: 'Validation and KPIs',
    summaryDims: ['iris_validation', 'iris_results'],
    systemPrompt: `Write the validation and KPI assessment section. For each key performance indicator defined in the DoA, state: the target, the result achieved, whether the target was met, and any deviations with explanation. Include pilot or demonstration results where applicable. Use a structured format: KPI → Target → Result → Status.` + HALLUCINATION_GUARD,
    wordTarget: 500,
  },
}

// ─── CONTEXT RETRIEVAL ────────────────────────────────────────────────────────

async function getDeliverableContext(
  section: string,
  projectCode: string,
  wpNumber: string,
  deliverableTitle: string,
  additionalContext: string,
  projTechSummary: string
): Promise<{ chunks: string; summaries: string }> {
  const cfg = SECTION_CONFIGS[section]
  if (!cfg) return { chunks: '', summaries: '' }

  const seeds = buildSeeds(section, projTechSummary, deliverableTitle)
  const queryText = seeds[0]

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
  wpNumber: string,
  meta: {
    leadBeneficiary?: string
    contributingBeneficiaries?: string[]
    dueMonth?: number
    actualDeliveryMonth?: number
    disseminationLevel?: string
    nature?: string
    version?: string
    authors?: string[]
    reviewers?: string[]
    kpis?: KPI[]
    acceptanceCriteria?: string[]
    annexes?: Array<{ label: string; location: string }>
  }
): Promise<Buffer> {
  const children: Array<Paragraph | Table> = []

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: `${deliverableRef}: ${deliverableTitle}`, bold: true, size: 36, color: IRIS_DARK })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 },
  }))

  // Annex 1 metadata table
  const metaRows: Array<[string, string]> = [
    ['Project', projectCode],
    ['Work Package', wpNumber],
    ['Deliverable Ref', deliverableRef],
    ['Dissemination Level', meta.disseminationLevel || ''],
    ['Nature', meta.nature || ''],
    ['Due Month', meta.dueMonth != null ? String(meta.dueMonth) : ''],
    ['Actual Delivery', meta.actualDeliveryMonth != null ? String(meta.actualDeliveryMonth) : ''],
    ['Lead Beneficiary', meta.leadBeneficiary || ''],
    ['Contributing Beneficiaries', (meta.contributingBeneficiaries || []).join(', ')],
    ['Version', meta.version || ''],
    ['Authors', (meta.authors || []).join(', ')],
    ['Reviewers', (meta.reviewers || []).join(', ')],
  ].filter(([, v]) => v !== '') as Array<[string, string]>

  if (metaRows.length > 0) {
    const tableRows = metaRows.map(([key, value]) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: key, bold: true, size: 18 })] })],
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: value, size: 18 })] })],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
      })
    )

    children.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }))

    children.push(new Paragraph({ spacing: { after: 400 } }))
  }

  const sectionOrder = ['executive_summary', 'methodology', 'technical_results', 'iris_contribution', 'validation', 'conclusions']

  for (const sectionId of sectionOrder) {
    if (!sections[sectionId]) continue
    const cfg = SECTION_CONFIGS[sectionId]

    children.push(new Paragraph({
      children: [new TextRun({ text: cfg.label, bold: true, size: 28, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    }))

    const paragraphs = sections[sectionId].split('\n\n').filter(p => p.trim())
    for (const para of paragraphs) {
      children.push(new Paragraph({
        children: [new TextRun({ text: para.trim(), size: 22 })],
        spacing: { after: 160 },
        alignment: AlignmentType.JUSTIFIED,
      }))
    }

    // KPI table — injected after validation prose
    if (sectionId === 'validation' && meta.kpis && meta.kpis.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'KPI Summary Table', bold: true, size: 22, color: IRIS_DARK })],
        spacing: { before: 240, after: 120 },
      }))

      const kpiHeaderRow = new TableRow({
        children: ['KPI ID', 'Description', 'Target', 'Result', 'Status'].map(h =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
          })
        ),
        tableHeader: true,
      })

      const kpiDataRows = meta.kpis.map(kpi => {
        const statusIcon = kpi.status === 'met' ? '✓' : kpi.status === 'partial' ? '↻' : '✗'
        return new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: kpi.id, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: kpi.description, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: kpi.target, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: kpi.result, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${statusIcon} ${kpi.status}`, size: 18 })] })] }),
          ],
        })
      })

      children.push(new Table({
        rows: [kpiHeaderRow, ...kpiDataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }))

      children.push(new Paragraph({ spacing: { after: 200 } }))
    }

    // Acceptance criteria — injected at end of conclusions
    if (sectionId === 'conclusions' && meta.acceptanceCriteria && meta.acceptanceCriteria.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Acceptance Criteria', bold: true, size: 24, color: IRIS_DARK })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }))
      meta.acceptanceCriteria.forEach((criterion, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${i + 1}. ${criterion}`, size: 22 })],
          spacing: { after: 100 },
        }))
      })
    }
  }

  // Annexes section
  if (meta.annexes && meta.annexes.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Annexes', bold: true, size: 28, color: IRIS_DARK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      border: { bottom: { color: IRIS_CYAN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    }))
    meta.annexes.forEach((annex, i) => {
      const annexText = annex.location ? `${i + 1}. ${annex.label} — ${annex.location}` : `${i + 1}. ${annex.label}`
      children.push(new Paragraph({
        children: [new TextRun({ text: annexText, size: 22 })],
        spacing: { after: 100 },
      }))
    })
  }

  // AI footer
  children.push(new Paragraph({
    children: [new TextRun({
      text: 'This deliverable was prepared with AI-assisted drafting (IRIS Knowledge Base). All content has been reviewed and validated by the responsible IRIS team members.',
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
  const {
    section,
    projectCode,
    wpNumber = 'WP1',
    deliverableRef = 'D1.1',
    deliverableTitle = '',
    additionalContext = '',
    outputType,
    generatedSections,
    // New metadata fields
    leadBeneficiary,
    contributingBeneficiaries,
    dueMonth,
    actualDeliveryMonth,
    disseminationLevel,
    nature,
    version,
    authors,
    reviewers,
    kpis,
    acceptanceCriteria,
    annexes,
  } = body

  // DOCX export path
  if (outputType === 'docx' && generatedSections) {
    try {
      const buffer = await buildDeliverableDocx(
        generatedSections,
        projectCode,
        deliverableRef,
        deliverableTitle,
        wpNumber,
        {
          leadBeneficiary,
          contributingBeneficiaries,
          dueMonth,
          actualDeliveryMonth,
          disseminationLevel,
          nature,
          version,
          authors,
          reviewers,
          kpis,
          acceptanceCriteria,
          annexes,
        }
      )
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
    // Fetch project tech summary for dynamic seeds and framing
    const allSummaries = await fetchSummariesByDimension(['iris_technology', 'iris_role'])
    const projSummary = allSummaries.find(p => p.project_code.toUpperCase() === projectCode.toUpperCase())
    const projTechSummary = projSummary?.dimensions?.['iris_technology'] || ''

    const [irisFraming, { chunks, summaries }] = await Promise.all([
      buildIrisFraming(projectCode),
      getDeliverableContext(section, projectCode, wpNumber, deliverableTitle, additionalContext, projTechSummary),
    ])

    const criteriaBlock = (acceptanceCriteria as string[] | undefined)?.length
      ? `\n\nACCEPTANCE CRITERIA (address each one in conclusions):\n${(acceptanceCriteria as string[]).map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}`
      : ''

    const systemPrompt = [
      irisFraming,
      STYLE_ENFORCEMENT,
      `\n## Deliverable Context\nProject: ${projectCode}\nWork Package: ${wpNumber}\nDeliverable: ${deliverableRef} — ${deliverableTitle}`,
      summaries ? `\n## Project Summary (from IRIS knowledge base)\n${summaries}` : '',
      chunks ? `\n## Relevant Document Chunks\n${chunks}` : '',
      additionalContext ? `\n## Additional Context Provided\n${additionalContext}` : '',
      section === 'conclusions' && criteriaBlock ? criteriaBlock : '',
      `\n## Your Task\n${cfg.systemPrompt}`,
      `\nTarget length: approximately ${cfg.wordTarget} words.`,
    ].filter(Boolean).join('\n')

    const model = process.env.IRIS_DELIVERABLE_MODEL || process.env.IRIS_PROPOSAL_MODEL || 'gpt-4o'

    // Buffered (non-streaming) completion so guards can be applied before response
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: systemPrompt }],
      temperature: 0.4,
      max_tokens: cfg.wordTarget > 500 ? 2500 : 2000,
      stream: false,
    })

    let text = completion.choices[0]?.message?.content || ''
    text = stripPlaceholders(text)
    text = scrubForbidden(text)
    text = stripFabrications(text, ['IRIS', projectCode])

    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (e: any) {
    console.error('Deliverable generation error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
