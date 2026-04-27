/**
 * IRIS KB — Proposal Annex Export
 *
 * POST { annexType, brief }
 *   → skeleton .docx for optional HE Part B annexes
 *
 * annexType: 'clinical_trials' | 'fstp' | 'security' | 'ethics'
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, PageNumber, Header, Footer, UnderlineType,
  type IRunOptions,
} from 'docx'
import type { ProjectBrief } from '@/lib/proposal-types'

const MM_TO_TWIP = 56.7
const MARGIN_15MM = Math.round(15 * MM_TO_TWIP)
const FONT = 'Arial'
const RUN_BODY:    Partial<IRunOptions> = { font: FONT, size: 22 }
const RUN_SUBHEAD: Partial<IRunOptions> = { font: FONT, size: 24, bold: true }
const RUN_HEAD:    Partial<IRunOptions> = { font: FONT, size: 28, bold: true }
const RUN_TITLE:   Partial<IRunOptions> = { font: FONT, size: 36, bold: true }
const RUN_SMALL:   Partial<IRunOptions> = { font: FONT, size: 18 }
const LINE_SPACING = { line: 276, lineRule: 'auto' as const }

function bodyPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, ...RUN_BODY })],
    spacing: { after: 160, ...LINE_SPACING },
  })
}

function guidancePara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, ...RUN_SMALL, color: '888888', italics: true })],
    spacing: { after: 120, ...LINE_SPACING },
  })
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, ...RUN_HEAD, underline: { type: UnderlineType.SINGLE } })],
    spacing: { before: 480, after: 160, ...LINE_SPACING },
    pageBreakBefore: true,
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, ...RUN_SUBHEAD })],
    spacing: { before: 240, after: 120, ...LINE_SPACING },
  })
}

interface AnnexDef {
  label: string
  filename: string
  intro: string
  sections: Array<{ title: string; guidance: string; placeholder: string }>
}

const ANNEX_DEFS: Record<string, AnnexDef> = {
  clinical_trials: {
    label: 'Annex — Clinical Trials',
    filename: 'Annex_ClinicalTrials.docx',
    intro: 'Complete this annex if the project involves clinical trials or studies on human participants. Provide information for each planned clinical study.',
    sections: [
      {
        title: '1. List of planned clinical studies',
        guidance: 'List all planned clinical trials/studies, including phase, location, and sponsor.',
        placeholder: 'Study 1:\n• Title:\n• Phase:\n• Sponsor:\n• Location(s):\n• Number of participants:\n• Start date (estimated):',
      },
      {
        title: '2. Regulatory framework and ethical approvals',
        guidance: 'Describe the applicable regulatory framework (e.g. EU Clinical Trials Regulation No 536/2014), Ethics Committee approvals obtained or planned, and national competent authority requirements.',
        placeholder: '(Describe regulatory framework and approvals)',
      },
      {
        title: '3. Good Clinical Practice (GCP)',
        guidance: 'Confirm adherence to ICH GCP guidelines and describe quality assurance/monitoring arrangements.',
        placeholder: '(Describe GCP compliance measures)',
      },
      {
        title: '4. Informed consent and data protection',
        guidance: 'Describe the informed consent procedure, GDPR compliance measures, and how participant data will be pseudonymised/anonymised.',
        placeholder: '(Describe informed consent process and data protection measures)',
      },
      {
        title: '5. Risk and safety monitoring',
        guidance: 'Describe the Data Safety Monitoring Board (DSMB) structure or equivalent, adverse event reporting procedures, and stopping rules.',
        placeholder: '(Describe safety monitoring arrangements)',
      },
    ],
  },

  fstp: {
    label: 'Annex — Financial Support to Third Parties (FSTP)',
    filename: 'Annex_FSTP.docx',
    intro: 'Complete this annex if the project includes cascade funding or grants to third parties (e.g. open calls, sub-grants). Maximum per recipient is €60,000 unless specifically justified and approved.',
    sections: [
      {
        title: '1. Objectives of the financial support',
        guidance: 'Explain why financial support to third parties is necessary to achieve the project objectives and how it relates to the work plan.',
        placeholder: '(Describe the objectives and rationale for FSTP)',
      },
      {
        title: '2. Eligible recipients',
        guidance: 'Define the types of organisations or individuals eligible to receive financial support (e.g. SMEs, start-ups, researchers, civil society organisations). Include any exclusion criteria.',
        placeholder: '(Define eligible recipients and exclusion criteria)',
      },
      {
        title: '3. Selection criteria and procedure',
        guidance: 'Describe the open, transparent, fair selection process (e.g. open call with evaluation committee, scoring criteria, conflict of interest management).',
        placeholder: '(Describe selection process and criteria)',
      },
      {
        title: '4. Maximum amount per recipient and total budget',
        guidance: 'State the maximum grant per third party (must not exceed €60,000 unless otherwise specified in the call). Provide a breakdown of the total FSTP budget.',
        placeholder: 'Maximum per recipient: €\nTotal FSTP budget: €\nEstimated number of recipients:',
      },
      {
        title: '5. Use of funds and reporting',
        guidance: 'Describe permitted uses of sub-grants, reporting obligations on recipients, and how the beneficiary will verify proper use of funds.',
        placeholder: '(Describe permitted uses, monitoring, and reporting requirements)',
      },
    ],
  },

  security: {
    label: 'Annex — Security Aspects',
    filename: 'Annex_SecurityAspects.docx',
    intro: 'Complete this annex if the project involves security-sensitive information, classified research, dual-use technology, or outputs that may be restricted from open publication.',
    sections: [
      {
        title: '1. Security-sensitive information and technologies',
        guidance: 'Identify any security-sensitive topics, technologies, or results arising from the project. Consider dual-use potential, export control regulations (e.g. EAR, ITAR, EU dual-use regulation), and cybersecurity implications.',
        placeholder: '(Describe security-sensitive elements, if any)',
      },
      {
        title: '2. Classified information',
        guidance: 'State whether the project will involve EU classified information (EUCI) or national classified information. If yes, identify the classification level and the relevant national security authority.',
        placeholder: 'Does the project involve classified information? Yes / No\nIf yes:\n• Classification level:\n• National Security Authority:',
      },
      {
        title: '3. Access control and personnel security',
        guidance: 'Describe measures to restrict access to sensitive information, personnel security clearance requirements, and secure facilities to be used.',
        placeholder: '(Describe access control and personnel security measures)',
      },
      {
        title: '4. Publication restrictions and open science compliance',
        guidance: 'Identify any results that may be subject to publication restrictions or embargo periods, and explain how compliance with the open science mandate will be balanced with security requirements.',
        placeholder: '(Describe publication restrictions and mitigation measures)',
      },
      {
        title: '5. Cybersecurity measures',
        guidance: 'Describe cybersecurity measures for protecting digital assets, data, and communications within the consortium.',
        placeholder: '(Describe cybersecurity measures)',
      },
    ],
  },

  ethics: {
    label: 'Annex — Ethics Self-Assessment',
    filename: 'Annex_EthicsSelfAssessment.docx',
    intro: 'This annex provides the detailed ethics self-assessment required by the European Commission. Review each ethics issue and complete only the sections relevant to your project.',
    sections: [
      {
        title: '1. Ethics issues table',
        guidance: 'For each ethics issue identified in the Application Form, provide a detailed description of the issue and the measures taken or planned to address it.',
        placeholder: 'Ethics issue 1:\n• Description:\n• Measures to address:\n\nEthics issue 2:\n• Description:\n• Measures to address:',
      },
      {
        title: '2. Research involving human participants',
        guidance: 'If applicable, describe the measures taken to ensure informed consent, voluntary participation, right to withdraw, and data protection in compliance with GDPR.',
        placeholder: 'Informed consent procedure:\nRight to withdraw:\nData protection measures:',
      },
      {
        title: '3. Dual-use research of concern (DURC)',
        guidance: 'If applicable, describe how dual-use risks have been assessed and what safeguards are in place to prevent misuse of research results.',
        placeholder: '(Describe DURC assessment and safeguards)',
      },
      {
        title: '4. Environmental and animal research',
        guidance: 'If applicable, describe compliance with EU Directive 2010/63/EU on protection of animals used for scientific purposes, and any environmental risk assessments conducted.',
        placeholder: '(Describe compliance with animal/environmental ethics requirements)',
      },
      {
        title: '5. Data protection and privacy (GDPR)',
        guidance: 'Describe data management practices, legal basis for processing personal data, data minimisation, storage limitation, and the role of the Data Protection Officer if applicable.',
        placeholder: 'Legal basis for processing:\nTypes of personal data:\nData minimisation measures:\nRetention period:\nDPO contact (if applicable):',
      },
      {
        title: '6. Other ethics issues',
        guidance: 'Describe any other ethics issues relevant to the project (e.g. use of AI, social implications, potential for misuse, research involving vulnerable groups).',
        placeholder: '(Describe any additional ethics issues and mitigation measures)',
      },
    ],
  },
}

export async function POST(req: NextRequest) {
  try {
    const { annexType, brief }: { annexType: string; brief: ProjectBrief } = await req.json()
    const def = ANNEX_DEFS[annexType]
    if (!def) {
      return NextResponse.json({ error: `Unknown annex type: ${annexType}` }, { status: 400 })
    }

    const acronym = brief?.acronym || 'PROPOSAL'
    const callId  = brief?.callId  || ''

    const children: Paragraph[] = [
      // Title
      new Paragraph({
        children: [new TextRun({ text: def.label, ...RUN_TITLE, color: '0A2E36' })],
        spacing: { before: 480, after: 240 },
      }),
      new Paragraph({
        children: [new TextRun({ text: acronym, ...RUN_HEAD, color: '00C4D4' })],
        spacing: { after: 160 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Call: ${callId}`, ...RUN_BODY })],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          ...RUN_BODY, color: '64748B',
        })],
        spacing: { after: 480 },
      }),
      // Intro
      guidancePara(def.intro),
    ]

    for (const sec of def.sections) {
      children.push(h1(sec.title))
      children.push(guidancePara(sec.guidance))
      children.push(bodyPara(sec.placeholder))
    }

    const doc = new Document({
      creator: 'IRIS KB',
      lastModifiedBy: 'IRIS KB',
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: {
          page: {
            margin: { top: MARGIN_15MM, bottom: MARGIN_15MM, left: MARGIN_15MM, right: MARGIN_15MM },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${acronym} — ${callId}`, ...RUN_SMALL, color: '444444' })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Annex — Page ', ...RUN_SMALL }),
                new TextRun({ children: [PageNumber.CURRENT], ...RUN_SMALL }),
              ],
            })],
          }),
        },
        children,
      }],
    })

    const buffer = await Packer.toBuffer(doc)
    const filename = `IRIS_${acronym.replace(/\s+/g, '_')}_${def.filename}`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (e: any) {
    console.error('Annex export error:', e)
    return NextResponse.json({ error: e.message || 'Annex export failed' }, { status: 500 })
  }
}
