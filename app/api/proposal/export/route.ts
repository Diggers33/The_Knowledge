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
  LevelFormat, convertInchesToTwip, UnderlineType,
  type IRunOptions,
} from 'docx'
import type { ProjectBrief } from '@/lib/proposal-types'
import type { ProposalTemplate } from '@/lib/proposal-templates'

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

function textToParagraphs(text: string): Paragraph[] {
  if (!text?.trim()) return [bodyPara('(Not yet written)')]

  const clean = text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()

  return clean
    .split(/\n{2,}/)
    .filter(p => p.trim())
    .map(p => {
      const line = p.trim()
      if (line.startsWith('■') || line.startsWith('•') || line.startsWith('-')) {
        return new Paragraph({
          children: [new TextRun({ text: line.replace(/^[■•\-]\s*/, '• '), ...RUN_BODY })],
          spacing: { after: 80, ...LINE_SPACING },
          indent: { left: convertInchesToTwip(0.3) },
        })
      }
      return bodyPara(line)
    })
}

// ─── SECTION PARAGRAPHS BUILDER ───────────────────────────────────────────────

function buildSectionParagraphs(
  sections: Record<string, string>,
  template: ProposalTemplate,
  brief: ProjectBrief
): Paragraph[] {
  const paras: Paragraph[] = []

  for (const sec of template.sections) {
    // Only output top-level sections as level-1 headings; subsections as level-2
    const isTop = !sec.id.match(/^\d+\.\d+/) && sec.title.match(/^\d+\./)
    const isSub = sec.title.match(/^\d+\.\d+/)

    if (isTop) {
      paras.push(headingPara(sec.title, 1))
    } else if (isSub) {
      paras.push(headingPara(sec.title, 2))
    } else {
      paras.push(headingPara(sec.title, 2))
    }

    const { mainText, references, kbSources } = splitSectionAndReferences(sections[sec.id] || '')
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
          new Paragraph({
            children: [new TextRun({ text: `Partners: ${(brief.partners || []).map(p => `${p.acronym} (${p.country})`).join(', ')}`, ...RUN_BODY })],
            spacing: { after: 80 },
          }),

          // Page break before sections
          new Paragraph({ children: [new PageBreak()] }),

          // ── Section content ────────────────────────────────────────────────
          ...buildSectionParagraphs(cleanSections, template, brief),
        ],
      }],
    })

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
    return NextResponse.json({ error: e.message || 'Export failed' }, { status: 500 })
  }
}
