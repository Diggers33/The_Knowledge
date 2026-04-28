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
import { getSource } from '@/lib/server/source-cache'
import type { SourceDoc } from '@/lib/server/source-cache'

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
  text = text.replace(/\b(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g, '[name redacted]')
  text = text.replace(/\bH-index\s+(?:of\s+)?\d+/gi, '')
  text = text.replace(/\b\d+\s+patents?\b/gi, '')
  return text
}

// P0-A — degeneracy guard
function isDegenerate(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length
  if (words < 20) return true
  // Repeating pattern > 200 chars (token loop like "4.2.1.1.1.1...")
  if (/(.{1,15})\1{15,}/s.test(text)) return true
  return false
}

// P0-C — strip leaked system-prompt artifacts from model output
const SYSTEM_LEAK_RE = /^#+\s*(Your Task|Relevant Document Chunks|Project Summary|Additional Context Provided|Deliverable Context|Acceptance Criteria).*$/gm
const TARGET_LENGTH_RE = /^Target length:.*$/gm
function stripSystemLeaks(text: string): string {
  return text
    .replace(SYSTEM_LEAK_RE, '')
    .replace(TARGET_LENGTH_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Prompt-echo guard
const PROMPT_ECHO_PATTERNS: RegExp[] = [
  /^Deliverable:\s+D\d/i,
  /^Project:\s+\w+\s*\|\s*Work Package:/im,
  /\bACCEPTANCE CRITERIA \(address each one\)/i,
  /^Task:\s*Write/im,
  /Write approximately \d+ words\.?\s*$/im,
  /^Additional Context:/im,
  /=== METADATA ===|=== PRIMARY SOURCE MATERIAL ===|=== SECONDARY CONTEXT/i,
  /Begin the section now\. Do not echo/i,
]

function detectPromptEcho(text: string): { isEcho: boolean; matches: string[] } {
  const matches: string[] = []
  for (const re of PROMPT_ECHO_PATTERNS) {
    const m = text.match(re)
    if (m) matches.push(m[0])
  }
  const head = text.slice(0, 200)
  const headHit = PROMPT_ECHO_PATTERNS.some(re => re.test(head))
  return { isEcho: matches.length >= 2 || headHit, matches }
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
  maxKBChunks: number
  sourceCategoriesPriority: string[]
}> = {
  executive_summary: {
    label: 'Executive Summary',
    summaryDims: ['iris_results', 'iris_role'],
    systemPrompt: `Write the executive summary for this deliverable. Cover: (1) the objective and scope of this deliverable, (2) the methods or approach used, (3) the key results and outcomes achieved, (4) status against plan. Be specific — name the WP, deliverable reference, and any key metrics. 2–3 paragraphs.`,
    wordTarget: 300,
    maxKBChunks: 2,
    sourceCategoriesPriority: ['report', 'spec', 'measurements'],
  },
  technical_results: {
    label: 'Technical Results',
    summaryDims: ['iris_results', 'iris_technology', 'iris_validation'],
    systemPrompt: `Write the technical results section. Present the specific outcomes achieved: measurements taken, models built, accuracy figures, TRL advancement. Use subsections if needed. Every claim must be supported by a specific figure, percentage, or reference. Do not write in future tense.`,
    wordTarget: 600,
    maxKBChunks: 1,
    sourceCategoriesPriority: ['measurements', 'report'],
  },
  iris_contribution: {
    label: 'IRIS Contribution',
    summaryDims: ['iris_role', 'iris_technology', 'iris_results'],
    systemPrompt: `Write the IRIS Technology Solutions contribution section. Describe specifically: which tasks IRIS led, what IRIS developed or built, what results IRIS achieved, and how IRIS's contribution fits within the broader WP. Only name technologies that are present in the Primary Source Material or Project Summary — do not introduce technology names from other projects. Write in past tense.`,
    wordTarget: 400,
    maxKBChunks: 0,
    sourceCategoriesPriority: ['report', 'spec'],
  },
  methodology: {
    label: 'Methodology',
    summaryDims: ['iris_technology'],
    systemPrompt: `Write the methodology section describing how the work was carried out. Cover: experimental setup, instruments used, data collection procedure, analysis approach, and any standards or protocols followed. Be specific about instrument specifications, sample sizes, and analytical methods. Write in past tense.`,
    wordTarget: 500,
    maxKBChunks: 3,
    sourceCategoriesPriority: ['spec', 'report'],
  },
  conclusions: {
    label: 'Conclusions and Next Steps',
    summaryDims: ['iris_results', 'iris_validation'],
    systemPrompt: `Write the conclusions and next steps section. Summarise the key findings of this deliverable, compare outcomes against the targets set in the DoA, identify any challenges encountered and how they were addressed, and outline the next steps for the following period. Close with the TRL status if relevant. For each acceptance criterion listed (if any), state in one sentence the evidence demonstrating it has been met.`,
    wordTarget: 400,
    maxKBChunks: 1,
    sourceCategoriesPriority: ['report', 'measurements'],
  },
  validation: {
    label: 'Validation and KPIs',
    summaryDims: ['iris_validation', 'iris_results'],
    systemPrompt: `Write the validation and KPI assessment section. For each key performance indicator defined in the DoA, state: the target, the result achieved, whether the target was met, and any deviations with explanation. Include pilot or demonstration results where applicable. Use a structured format: KPI → Target → Result → Status.`,
    wordTarget: 500,
    maxKBChunks: 1,
    sourceCategoriesPriority: ['measurements', 'report'],
  },
}

// ─── CONTEXT RETRIEVAL ────────────────────────────────────────────────────────

function buildSourceBlock(sourceDoc: SourceDoc, section: string): string {
  const cfg = SECTION_CONFIGS[section]
  if (!cfg || !sourceDoc.files.length) return ''

  const priorityOrder = cfg.sourceCategoriesPriority
  const sorted = [...sourceDoc.files].sort((a, b) => {
    const ai = priorityOrder.indexOf(a.category)
    const bi = priorityOrder.indexOf(b.category)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  return sorted.map((f, idx) => {
    const parts: string[] = [`[S${idx + 1}] ${f.fileName} · category=${f.category}`]
    if (f.tables.length > 0) {
      // Include top tables as markdown
      const tablesToShow = f.tables.slice(0, 3)
      for (const t of tablesToShow) {
        if (t.sheetName) parts.push(`Sheet: ${t.sheetName}`)
        if (t.title) parts.push(t.title)
        const rows = t.rows.slice(0, 30)
        parts.push(rows.map(r => `| ${r.join(' | ')} |`).join('\n'))
      }
    }
    // Include first 3000 chars of text after tables
    const textPreview = f.extractedText.slice(0, 3000)
    if (textPreview.trim()) parts.push(textPreview)
    return parts.join('\n')
  }).join('\n\n---\n\n')
}

async function getDeliverableContext(
  section: string,
  projectCode: string,
  wpNumber: string,
  deliverableTitle: string,
  additionalContext: string,
  projTechSummary: string,
  sourceDoc: SourceDoc | null,
): Promise<{ chunks: string; summaries: string; sourceBlock: string }> {
  const cfg = SECTION_CONFIGS[section]
  if (!cfg) return { chunks: '', summaries: '', sourceBlock: '' }

  const sourceBlock = sourceDoc ? buildSourceBlock(sourceDoc, section) : ''

  // KB retrieval: skip entirely for iris_contribution (cross-project leak prevention)
  let chunks = ''
  if (cfg.maxKBChunks > 0) {
    const seeds = buildSeeds(section, projTechSummary, deliverableTitle)
    const queryText = seeds[0]
    const embedding = await embed(queryText)
    const rawChunks = await searchChunks(embedding, queryText, 20, [projectCode])

    const projectNorm = projectCode.toUpperCase()
    const scopedChunks = rawChunks.filter(c =>
      typeof c.project_tag === 'string' && c.project_tag.toUpperCase() === projectNorm
    )
    if (rawChunks.length > 0 && scopedChunks.length === 0) {
      console.warn(`[deliverable] retrieval returned ${rawChunks.length} chunks but none tagged ${projectCode} — using empty context`)
    }

    const reranked = scopedChunks.length > 0
      ? (await rerankChunks(`${section} ${deliverableTitle}`, scopedChunks)).slice(0, cfg.maxKBChunks)
      : []

    chunks = reranked.map((c, i) => `[K${i + 1}] ${c.chunk_text}`).join('\n\n')
  }

  const allSummaries = await fetchSummariesByDimension(cfg.summaryDims)
  const projectSummary = allSummaries.find(p => p.project_code.toUpperCase() === projectCode.toUpperCase())
  const summaries = projectSummary
    ? cfg.summaryDims
        .map(dim => projectSummary.dimensions[dim] ? `**${dim}**: ${projectSummary.dimensions[dim]}` : '')
        .filter(Boolean)
        .join('\n\n')
    : ''

  return { chunks, summaries, sourceBlock }
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
    sourceDocId,
    // Metadata fields
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
    // Resolve source doc (if sourceDocId provided)
    let sourceDoc: SourceDoc | null = null
    if (sourceDocId) {
      sourceDoc = await getSource(sourceDocId)
      if (!sourceDoc) {
        return NextResponse.json({ error: 'source_cache_miss', message: 'Source material expired. Please re-upload.' }, { status: 410 })
      }
    }

    // Fetch project tech summary for dynamic seeds and framing
    const allSummaries = await fetchSummariesByDimension(['iris_technology', 'iris_role'])
    const projSummary = allSummaries.find(p => p.project_code.toUpperCase() === projectCode.toUpperCase())
    const projTechSummary = projSummary?.dimensions?.['iris_technology'] || ''

    const [irisFraming, { chunks, summaries, sourceBlock }] = await Promise.all([
      buildIrisFraming(projectCode),
      getDeliverableContext(section, projectCode, wpNumber, deliverableTitle, additionalContext, projTechSummary, sourceDoc),
    ])

    const criteriaBlock = (acceptanceCriteria as string[] | undefined)?.length
      ? (acceptanceCriteria as string[]).map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')
      : ''

    // New prompt structure: task in system, data in user, anti-echo imperative at end
    const systemInstruction = [
      irisFraming,
      STYLE_ENFORCEMENT,
      HALLUCINATION_GUARD,
      `\nSECTION: ${cfg.label}`,
      `TARGET LENGTH: ${cfg.wordTarget} words (±20%)`,
      `TASK: ${cfg.systemPrompt}`,
      `\nEVIDENCE PRIORITY:`,
      `1. PRIMARY SOURCE MATERIAL (uploaded by user) — preferred for all factual claims`,
      `2. PROJECT SUMMARY — for framing only`,
      `3. SECONDARY CONTEXT (IRIS KB) — only when source material is silent on a point`,
      `4. ADDITIONAL CONTEXT — for scope clarification`,
      `\nCITATION RULE: every numerical claim must be followed by [Sn] where n is the source file index. If no source supports a number, write [evidence required] instead of inventing.`,
    ].join('\n')

    const userContext = [
      `=== METADATA ===`,
      `Deliverable: ${deliverableRef} — ${deliverableTitle}`,
      `Project: ${projectCode}  |  Work Package: ${wpNumber}`,
      ``,
      `=== PRIMARY SOURCE MATERIAL ===`,
      sourceBlock || '(none — rely on project summary and secondary context)',
      ``,
      `=== PROJECT SUMMARY ===`,
      summaries || '(none)',
      ``,
      `=== SECONDARY CONTEXT (IRIS KB) ===`,
      chunks || '(none)',
      ``,
      `=== ADDITIONAL CONTEXT ===`,
      additionalContext || '(none)',
      ``,
      `=== ACCEPTANCE CRITERIA ===`,
      criteriaBlock || '(none)',
      ``,
      `Begin the section now. Do not echo this metadata. Do not include any "Task:" or "Write approximately N words" lines. Output only the section body.`,
    ].join('\n')

    const model = process.env.IRIS_DELIVERABLE_MODEL || process.env.IRIS_PROPOSAL_MODEL || 'gpt-4o'
    const maxTokens = cfg.wordTarget > 500 ? 2500 : 2000

    async function callModel(freqPenalty = 0, presPenalty = 0): Promise<string> {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user',   content: userContext },
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
        frequency_penalty: freqPenalty,
        presence_penalty: presPenalty,
        stream: false,
      })
      return completion.choices[0]?.message?.content || ''
    }

    let text = await callModel()

    // P0-A: degeneracy guard
    if (isDegenerate(text)) {
      console.warn(`[deliverable] degeneracy detected in ${section} — retrying with frequency_penalty=0.6`)
      text = await callModel(0.6, 0.3)
      if (isDegenerate(text)) {
        text = `[Section generation failed: please regenerate ${cfg.label}]`
      }
    }

    // Prompt-echo guard
    const echo = detectPromptEcho(text)
    if (echo.isEcho) {
      console.warn(`[deliverable] prompt-echo detected for section=${section}: ${echo.matches.join(', ')}`)
      text = await callModel(0.3, 0.6)
      const echo2 = detectPromptEcho(text)
      if (echo2.isEcho) {
        return new NextResponse(
          `[generation failed — model echoed prompt template; please regenerate or upload more source material]`,
          { status: 200, headers: { 'Content-Type': 'text/plain', 'X-Generation-Warning': 'prompt-echo' } }
        )
      }
    }

    text = stripSystemLeaks(text)
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
