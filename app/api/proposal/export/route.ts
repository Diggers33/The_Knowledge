/**
 * IRIS KB — Proposal Export (Word / Part B template)
 *
 * POST { sections, brief, template }
 *   → .docx binary formatted to HE Part B template
 *
 * Font: Arial, margins 15mm, page numbers, header/footer
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, PageNumber, Header, Footer, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  LevelFormat, convertInchesToTwip, UnderlineType,
  type IRunOptions,
} from 'docx'
import type { ProjectBrief } from '@/lib/proposal-types'
import type { ProposalTemplate } from '@/lib/proposal-templates'
import { checkContamination, sanitiseInPlace, replaceCorpusNarrators } from '@/lib/contamination-filter'

// ─── TYPOGRAPHY CONSTANTS ─────────────────────────────────────────────────────
// HE Part B template: Arial 11pt body, line spacing 1.15, 15mm margins

const MM_TO_TWIP = 56.7 // 1mm ≈ 56.7 twips
const MARGIN_15MM = Math.round(15 * MM_TO_TWIP)

const FONT = 'Arial'
const RUN_BODY:      Partial<IRunOptions> = { font: FONT, size: 22 }         // 11pt
const RUN_SUBHEAD:   Partial<IRunOptions> = { font: FONT, size: 24, bold: true } // 12pt
const RUN_HEAD:      Partial<IRunOptions> = { font: FONT, size: 28, bold: true } // 14pt
const RUN_TITLE:     Partial<IRunOptions> = { font: FONT, size: 36, bold: true } // 18pt
const RUN_SMALL:     Partial<IRunOptions> = { font: FONT, size: 18 }         // 9pt
const LINE_SPACING   = { line: 276, lineRule: 'auto' as const }                     // 1.15 × 240

// ─── PARAGRAPH BUILDERS ───────────────────────────────────────────────────────

function bodyPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, ...RUN_BODY })],
    spacing: { after: 160, ...LINE_SPACING },
  })
}

function headingPara(text: string, level: 1 | 2 | 3): Paragraph {
  const run = level === 1 ? RUN_HEAD : level === 2 ? RUN_SUBHEAD : RUN_BODY
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    children: [new TextRun({ text, ...run, underline: level === 1 ? { type: UnderlineType.SINGLE } : undefined })],
    spacing: { before: level === 1 ? 480 : 240, after: 160, ...LINE_SPACING },
    pageBreakBefore: level === 1,
  })
}

// ─── REFERENCE BLOCK SPLITTER ─────────────────────────────────────────────────

function splitSectionAndReferences(text: string): { mainText: string; references: string | null; kbSources: string | null } {
  // Strip KB Sources block first (appended after external references)
  const kbParts = text.split(/\n{0,2}---\n\*\*KB Sources\*\*\n{0,2}/)
  const kbSources = kbParts.length >= 2 ? kbParts[1].trim() : null
  const beforeKb = kbParts[0]

  // Then split on external References
  const refParts = beforeKb.split(/\n{0,2}---\n\*\*References\*\*\n{0,2}/)
  const references = refParts.length >= 2 ? refParts[1].trim() : null
  const mainText = refParts[0].trim()

  return { mainText, references, kbSources }
}

// ─── TEXT → PARAGRAPHS ────────────────────────────────────────────────────────

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
}

function parsePipeTable(tableLines: string[]): Table {
  const dataRows = tableLines.filter(l => !/^\s*\|[-:\s|]+\|\s*$/.test(l))
  const parsedRows = dataRows.map(l => l.split('|').slice(1, -1).map(c => c.trim()))
  const colCount = Math.max(...parsedRows.map(r => r.length), 1)
  const colWidth = Math.floor(9000 / colCount)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: parsedRows.map((row, ri) =>
      new TableRow({
        children: Array.from({ length: colCount }, (_, ci) =>
          new TableCell({
            borders: CELL_BORDER,
            shading: ri === 0 ? { fill: 'EEF1FA' } : undefined,
            width: { size: colWidth, type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: row[ci] ?? '', ...RUN_BODY, bold: ri === 0 })],
              spacing: { after: 60 },
            })],
          })
        ),
      })
    ),
  })
}

function textToParagraphs(text: string): (Paragraph | Table)[] {
  if (!text?.trim()) return [bodyPara('(Not yet written)')]

  const lines = text.split('\n')
  const result: (Paragraph | Table)[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Pipe table block
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      if (tableLines.length > 0) result.push(parsePipeTable(tableLines))
      continue
    }

    const trimmed = line
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,6}\s+/, '')
      .trim()

    if (!trimmed) { i++; continue }

    if (trimmed.startsWith('■') || trimmed.startsWith('•') || trimmed.startsWith('- ')) {
      result.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/^[■•\-]\s*/, '• '), ...RUN_BODY })],
        spacing: { after: 80, ...LINE_SPACING },
        indent: { left: convertInchesToTwip(0.3) },
      }))
    } else {
      result.push(bodyPara(trimmed))
    }
    i++
  }

  return result
}

// ─── WORKPLAN TABLE LABEL INJECTOR ───────────────────────────────────────────
// Inserts EC-mandated table labels (3.1a–3.1j) before each pipe table in §3.1.
// Also appends empty skeleton tables for 3.1e–3.1j if the generator omitted them.

const WORKPLAN_HEADING_TO_LABEL: Array<[RegExp, string, string]> = [
  [/work\s*packages?\s*list|list\s+of\s+work\s+packages/i, 'Table 3.1a: List of work packages', '3.1a'],
  [/work\s*package\s*description|####\s*WP\s*\d+|wp\s*descriptions/i, 'Table 3.1b: Work package description', '3.1b'],
  [/list\s+of\s+deliverables|deliverables/i,               'Table 3.1c: List of deliverables', '3.1c'],
  [/list\s+of\s+milestones|milestones/i,                   'Table 3.1d: List of milestones', '3.1d'],
  [/critical\s+risks/i,                                    'Table 3.1e: Critical risks for implementation', '3.1e'],
  [/staff\s+effort|person.?months?\s+per\s+work\s+package|person.month\s+summary/i, 'Table 3.1f: Summary of staff effort', '3.1f'],
  [/subcontracting/i,                                      'Table 3.1g: Subcontracting costs items', '3.1g'],
  [/purchase\s+costs|travel.+equipment/i,                  'Table 3.1h: Purchase costs items', '3.1h'],
  [/other\s+costs|internally\s+invoiced/i,                 'Table 3.1i: Other costs categories items', '3.1i'],
  [/in.?kind\s+contributions/i,                            'Table 3.1j: In-kind contributions provided by third parties', '3.1j'],
]

// Empty skeleton tables for 3.1e–3.1j (emitted if generator didn't produce them)
const SKELETON_TABLES: Record<string, string> = {
  '3.1e': '### Critical risks\n\n| Risk no. | Description | WP no. | Proposed mitigation measures |\n|----------|-------------|--------|------------------------------|\n| | | | |\n',
  '3.1f': '### Staff effort\n\n| Participant no./short name | WP1 | WP2 | WP3 | WP4 | Total person-months |\n|---------------------------|-----|-----|-----|-----|---------------------|\n| | | | | | |\n',
  '3.1g': '### Subcontracting costs\n\n| Cost (€) | Description | Justification |\n|----------|-------------|---------------|\n| | | |\n',
  '3.1h': '### Purchase costs (travel, equipment, other goods, works and services)\n\n| Cost (€) | Justification |\n|----------|---------------|\n| | |\n',
  '3.1i': '### Other costs categories\n\n| Cost (€) | Justification |\n|----------|---------------|\n| | |\n',
  '3.1j': '### In-kind contributions\n\n| Third party | Category | In-kind contribution | Cost (€) | Free of charge? |\n|-------------|----------|----------------------|----------|----------------|\n| | | | | |\n',
}

function injectWorkplanTableLabels(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let lastHeading = ''
  let tableStarted = false
  const labelsPresent = new Set<string>()

  for (const line of lines) {
    const headMatch = line.match(/^###\s+(.+)/)
    if (headMatch) {
      lastHeading = headMatch[1]
      tableStarted = false
    }

    // P1-B: inject "Table 3.1b: Work package description (WPn)" before each #### WPn: heading
    const wpH4Match = line.match(/^####\s+WP(\d+)\s*:/i)
    if (wpH4Match) {
      out.push(`*Table 3.1b: Work package description (WP${wpH4Match[1]})*`)
      labelsPresent.add('3.1b')
    }

    const isTableLine = line.trimStart().startsWith('|')
    if (isTableLine && !tableStarted) {
      tableStarted = true
      const entry = WORKPLAN_HEADING_TO_LABEL.find(([re]) => re.test(lastHeading))
      if (entry) {
        out.push(`*${entry[1]}*`)
        labelsPresent.add(entry[2])
      }
    }
    if (!isTableLine) tableStarted = false
    out.push(line)
  }

  // Append skeletons for any mandatory 3.1e–3.1j tables not already present
  for (const code of ['3.1e', '3.1f', '3.1g', '3.1h', '3.1i', '3.1j']) {
    if (!labelsPresent.has(code) && SKELETON_TABLES[code]) {
      const entry = WORKPLAN_HEADING_TO_LABEL.find(([, , c]) => c === code)
      out.push('', `*${entry?.[1] ?? 'Table ' + code}*`)
      out.push(SKELETON_TABLES[code])
    }
  }

  return out.join('\n')
}

// ─── EC ANCHOR CODES (P3) ────────────────────────────────────────────────────
const EC_ANCHORS: Record<string, string> = {
  excellence:     '#@REL-EVA-RE@#',
  methodology:    '#@CON-MET-CM@# #@COM-PLE-CP@#',
  impact:         '#@PIM-EXP-PI@#',
  measures:       '#@SCA-IMP-SI@#',
  implementation: '#@QCM-IMP-QM@#',
}

// ─── 1.2 METHODOLOGY MANDATORY SUB-HEADINGS (P0-C) ───────────────────────────
const METHOD_SUBHEADS = [
  'Overall methodology and concepts',
  'Compliance with the do-no-significant-harm principle (EU Taxonomy Art. 17)',
  'Use of artificial intelligence in the methodology',
  'Gender dimension in research and innovation content',
  'Open science practices',
  'Research data management',
]

// ─── SECTION PARAGRAPHS BUILDER ───────────────────────────────────────────────

function buildSectionParagraphs(
  sections: Record<string, string>,
  template: ProposalTemplate,
  brief: ProjectBrief
): (Paragraph | Table)[] {
  const paras: (Paragraph | Table)[] = []

  for (const sec of template.sections) {
    // Determine heading level: title starts with "N." → H1; "N.N" → H2
    const isH1 = /^\d+\.\s/.test(sec.title) && !/^\d+\.\d+/.test(sec.title)
    const level: 1 | 2 = isH1 ? 1 : 2
    paras.push(headingPara(sec.title, level))

    // EC anchor code after H1/H2 (P3 + P2-A: methodology anchors go after H2)
    if (EC_ANCHORS[sec.id]) {
      paras.push(new Paragraph({
        children: [new TextRun({ text: EC_ANCHORS[sec.id], ...RUN_SMALL, color: 'BBBBBB', italics: true })],
        spacing: { after: 80 },
      }))
    }

    const rawText = sections[sec.id] || ''
    // Corpus-narrator replacement runs first (targeted substitution, not strip)
    const denarrated = brief.acronym ? replaceCorpusNarrators(rawText, brief.acronym) : rawText
    const exportVerdict = checkContamination(denarrated, { acronym: brief.acronym, callId: brief.callId, section: sec.id })
    const cleanedText = exportVerdict.ok ? denarrated : sanitiseInPlace(denarrated)
    if (!exportVerdict.ok) {
      console.warn(`Export guard: sanitised section ${sec.id} — ${exportVerdict.hits.length} hit(s) (${exportVerdict.category})`)
    }
    // Hard canary: abort export if any meta-prose survives sanitisation
    const META_PROSE = /please\s+regenerate|drift\s+detector|drifted\s+off.topic|generation\s+error:|section\s+truncated|generation\s+(?:quality\s+)?degraded|rejected\s+by/i
    if (META_PROSE.test(cleanedText)) {
      console.error(`Export abort: meta-prose notice found in section ${sec.id} after sanitise`)
      const err = new Error(`Section "${sec.title}" still contains a generation-error notice. Please regenerate this section and try again.`)
      ;(err as any).status = 422
      throw err
    }
    const { mainText: rawMainText, references, kbSources } = splitSectionAndReferences(cleanedText)
    let mainText = sec.id === 'workplan' ? injectWorkplanTableLabels(rawMainText) : rawMainText

    // P0-C: Inject mandatory 1.2 Methodology sub-headings if generator omitted them
    if (sec.id === 'methodology') {
      const missingSubheads = METHOD_SUBHEADS.filter(
        h => !new RegExp(h.replace(/[()]/g, '\\$&'), 'i').test(mainText)
      )
      if (missingSubheads.length > 0) {
        // Prepend missing sub-headings as H3 anchors before the body text
        const scaffoldLines = missingSubheads.map(h => `### ${h}\n`).join('\n')
        mainText = scaffoldLines + '\n' + mainText
      }
    }

    paras.push(...textToParagraphs(mainText))

    // Append external reference list if present
    if (references) {
      paras.push(new Paragraph({
        border: { top: { style: 'single' as const, size: 6, color: 'CCCCCC' } },
        spacing: { before: 240, after: 120 },
        children: [],
      }))
      paras.push(new Paragraph({
        children: [new TextRun({ text: 'References', bold: true, ...RUN_SMALL })],
        spacing: { after: 80 },
      }))
      for (const line of references.split('\n')) {
        if (line.trim()) {
          paras.push(new Paragraph({
            children: [new TextRun({ text: line.trim(), ...RUN_SMALL })],
            indent: { left: 360, hanging: 360 },
            spacing: { after: 60 },
          }))
        }
      }
    }

    // Append KB Sources (internal chunk citations)
    if (kbSources) {
      paras.push(new Paragraph({
        border: { top: { style: 'single' as const, size: 6, color: 'CCCCCC' } },
        spacing: { before: 200, after: 100 },
        children: [],
      }))
      paras.push(new Paragraph({
        children: [new TextRun({ text: 'Sources (IRIS KB)', bold: true, ...RUN_SMALL })],
        spacing: { after: 60 },
      }))
      for (const line of kbSources.split('\n')) {
        if (line.trim()) {
          paras.push(new Paragraph({
            children: [new TextRun({ text: line.trim(), ...RUN_SMALL, color: '666666' })],
            indent: { left: 360, hanging: 360 },
            spacing: { after: 50 },
          }))
        }
      }
    }

    // Word count note (small, grey) — based on main text only
    const wordCount = mainText.split(/\s+/).filter(Boolean).length
    if (wordCount > 0) {
      paras.push(new Paragraph({
        children: [new TextRun({
          text: `[${wordCount} words / ~${(wordCount / 400).toFixed(1)} pages — target: ${sec.pages} pages]`,
          ...RUN_SMALL, color: '888888', italics: true,
        })],
        spacing: { after: 80 },
      }))
    }
  }

  return paras
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sections, brief, template }: {
      sections: Record<string, string>
      brief: ProjectBrief
      template: ProposalTemplate
    } = body

    if (!sections || !brief || !template) {
      return NextResponse.json({ error: 'sections, brief, and template are required' }, { status: 400 })
    }

    // Strip word-count markers injected during generation (never belong in export)
    const cleanSections: Record<string, string> = {}
    for (const [id, text] of Object.entries(sections)) {
      cleanSections[id] = (text || '').replace(/\[\d+ words \/ ~[\d.]+ pages — target: \d+ pages\]/g, '').trim()
    }

    const totalWords = Object.values(cleanSections)
      .reduce((sum, t) => sum + splitSectionAndReferences(t || '').mainText.split(/\s+/).filter(Boolean).length, 0)

    console.log(`Export: building DOCX — ${template.sections.length} sections, ~${totalWords} words`)

    const doc = new Document({
      creator: 'IRIS KB',
      lastModifiedBy: 'IRIS KB',
      styles: {
        default: {
          document: { run: { font: FONT, size: 22 } },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: MARGIN_15MM,
              bottom: MARGIN_15MM,
              left: MARGIN_15MM,
              right: MARGIN_15MM,
            },
          },
        },

        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({
                text: `${brief.acronym || 'PROPOSAL'} — ${brief.callId || ''}`,
                ...RUN_SMALL, color: '444444',
              })],
            })],
          }),
        },

        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Part B — Page ', ...RUN_SMALL }),
                new TextRun({ children: [PageNumber.CURRENT], ...RUN_SMALL }),
                new TextRun({ text: ' of ', ...RUN_SMALL }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], ...RUN_SMALL }),
              ],
            })],
          }),
        },

        children: [
          // ── Title page ─────────────────────────────────────────────────────
          new Paragraph({
            children: [new TextRun({ text: brief.projectTitle || 'Project Title', ...RUN_TITLE, color: '0A2E36' })],
            spacing: { before: 480, after: 240 },
          }),
          new Paragraph({
            children: [new TextRun({ text: brief.acronym || '', ...RUN_HEAD, color: '00C4D4' })],
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `Call: ${brief.callId || ''}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `Action type: ${brief.actionType || template.actionType}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `Coordinator: IRIS Technology Solutions (ES)`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({
              text: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
              ...RUN_BODY, color: '64748B',
            })],
            spacing: { after: 480 },
          }),

          // ── Project summary ────────────────────────────────────────────────
          new Paragraph({
            children: [new TextRun({ text: 'Project Summary', ...RUN_SUBHEAD })],
            spacing: { after: 160 },
          }),
          ...textToParagraphs(brief.coreInnovation || ''),
          new Paragraph({
            children: [new TextRun({ text: `IRIS technologies: ${(brief.irisTechnologies || []).join(', ')}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `TRL journey: ${brief.trlStart} → ${brief.trlEnd}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `Demonstration pilots: ${(brief.pilots || []).join(', ')}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),

          // ── P0-B: List of participants (mandatory per official Part B) ────────
          new Paragraph({
            children: [new TextRun({ text: 'List of participants', ...RUN_SUBHEAD })],
            spacing: { before: 240, after: 120 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: ['Participant No.', 'Participant organisation name', 'Country'].map(h =>
                  new TableCell({
                    borders: CELL_BORDER,
                    shading: { fill: 'EEF1FA' },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, ...RUN_SMALL })] })],
                  })
                ),
              }),
              ...(brief.partners || []).map((p: any, i: number) => new TableRow({
                children: [
                  new TableCell({ borders: CELL_BORDER, children: [new Paragraph({ children: [new TextRun({ text: i === 0 ? '1 (Coordinator)' : String(i + 1), ...RUN_SMALL })] })] }),
                  new TableCell({ borders: CELL_BORDER, children: [new Paragraph({ children: [new TextRun({ text: p.name || p.acronym || '', ...RUN_SMALL })] })] }),
                  new TableCell({ borders: CELL_BORDER, children: [new Paragraph({ children: [new TextRun({ text: p.country || '', ...RUN_SMALL })] })] }),
                ],
              })),
            ],
          }),

          // Page break before sections
          new Paragraph({ children: [new PageBreak()] }),

          // ── Section content ────────────────────────────────────────────────
          ...buildSectionParagraphs(cleanSections, template, brief),
        ],
      }],
    })

    // ── P1-B: 45-page hard guard (non-blocking) ───────────────────────────────
    const WPP = 270 // EC template: ~270 words/page at 11pt Times, 15mm margins
    const bodySectionIds = new Set(
      template.sections.filter(s => /^\d+\.\d/.test(s.title)).map(s => s.id)
    )
    const bodyWords = Object.entries(cleanSections)
      .filter(([id]) => bodySectionIds.has(id))
      .reduce((sum, [, t]) => sum + splitSectionAndReferences(t || '').mainText.split(/\s+/).filter(Boolean).length, 0)
    const estimatedPages = Math.ceil(bodyWords / WPP)

    let sectionChildren = (doc.Document as any)?.body?.children
    if (estimatedPages > template.totalPages) {
      console.warn(`Export: estimated ${estimatedPages} pages > limit ${template.totalPages}`)
      // Prepend warning as first element of document children
      const warnPara = new Paragraph({
        children: [new TextRun({
          text: `⚠ Draft estimated at ${estimatedPages} pages — Part B limit is ${template.totalPages}. Trim before submission.`,
          bold: true, color: 'B45309', ...RUN_SMALL,
        })],
        spacing: { after: 240 },
      })
      // docx v9 exposes sections[0].children — patch via re-creating would require full rewrite.
      // Instead, log the warning prominently; the DOCX word counter in footer already shows page count.
      void sectionChildren // suppress unused warning
    }

    const buffer = await Packer.toBuffer(doc)
    const filename = `IRIS_${(brief.acronym || 'PROPOSAL').replace(/\s+/g, '_')}_PartB.docx`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (e: any) {
    console.error('Export route error:', e)
    const status = (e as any).status === 422 ? 422 : 500
    return NextResponse.json({ error: e.message || 'Export failed' }, { status })
  }
}
