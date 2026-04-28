/**
 * IRIS KB — Proposal Upload
 *
 * POST (multipart/form-data) { file: .docx | .doc }
 *   → { text, wordCount, sectionsFound }
 *
 * PDFs are extracted client-side via pdfjs-dist (avoids server DOM deps).
 * This route handles DOCX/DOC only via mammoth.
 */

import { NextRequest, NextResponse } from 'next/server'

function detectSections(text: string): string[] {
  const headingPattern = /(?:^|\n)(\d+\.?\d*\.?\s+[A-Z][^\n]{3,60})/g
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = headingPattern.exec(text)) !== null) {
    found.push(m[1].trim())
    if (found.length >= 20) break
  }
  return found
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const filename = file.name.toLowerCase()
    if (!filename.endsWith('.docx') && !filename.endsWith('.doc')) {
      return NextResponse.json({ error: 'Only .doc and .docx files handled server-side' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const text: string = result.value

    const wordCount = text.split(/\s+/).filter(Boolean).length
    const sectionsFound = detectSections(text)

    return NextResponse.json({ text, wordCount, sectionsFound })
  } catch (e: any) {
    console.error('Upload route error:', e)
    return NextResponse.json({ error: e.message || 'Extraction failed' }, { status: 500 })
  }
}
