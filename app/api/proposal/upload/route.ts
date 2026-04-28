/**
 * IRIS KB — Proposal Upload
 *
 * POST (multipart/form-data) { file: .docx | .pdf }
 *   → { text, wordCount, sectionsFound }
 *
 * Requires: npm install mammoth pdf-parse @types/pdf-parse
 */

import { NextRequest, NextResponse } from 'next/server'

// Detect section headings like "3.1 Methodology", "2. Excellence", etc.
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

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const filename = file.name.toLowerCase()

    let text = ''

    if (filename.endsWith('.docx') || filename.endsWith('.doc')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (filename.endsWith('.pdf')) {
      // pdf-parse v2 API: PDFParse class with { data: buffer }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFParse } = require('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      const result = await parser.getText()
      text = result.text
    } else {
      return NextResponse.json(
        { error: 'Only .doc, .docx and .pdf files are supported' },
        { status: 400 }
      )
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length
    const sectionsFound = detectSections(text)

    return NextResponse.json({ text, wordCount, sectionsFound })
  } catch (e: any) {
    console.error('Upload route error:', e)
    // If packages are not installed, give a helpful message
    if (e.code === 'MODULE_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Missing dependency — run: npm install mammoth pdf-parse' },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: e.message || 'Extraction failed' }, { status: 500 })
  }
}
