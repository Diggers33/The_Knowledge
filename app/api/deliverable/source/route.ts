import { NextRequest, NextResponse } from 'next/server'
import { putSource, getSource, deleteFileFromSource } from '@/lib/server/source-cache'
import type { SourceDoc, SourceFile, SourceTable } from '@/lib/server/source-cache'

export const maxDuration = 60
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 30 * 1024 * 1024  // 30 MB

const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.md', '.txt', '.json'])

function ext(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

// ─── Extractors ───────────────────────────────────────────────────────────────

async function extractDocx(buf: Buffer): Promise<{ text: string; tables: SourceTable[]; fileName: string }> {
  const mammoth = await import('mammoth')
  const rawResult = await mammoth.extractRawText({ buffer: buf })
  const htmlResult = await mammoth.convertToHtml({ buffer: buf })

  // Parse tables from HTML
  const tables: SourceTable[] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tMatch: RegExpExecArray | null
  while ((tMatch = tableRe.exec(htmlResult.value)) !== null) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    const rows: string[][] = []
    let rMatch: RegExpExecArray | null
    while ((rMatch = rowRe.exec(tMatch[1])) !== null) {
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
      const cells: string[] = []
      let cMatch: RegExpExecArray | null
      while ((cMatch = cellRe.exec(rMatch[1])) !== null) {
        cells.push(cMatch[1].replace(/<[^>]+>/g, '').trim())
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length > 1) tables.push({ rows, sourceFile: '' })
  }

  return { text: rawResult.value, tables, fileName: '' }
}

async function extractXlsx(buf: Buffer, fileName: string): Promise<{ text: string; tables: SourceTable[] }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'buffer' })
  const tables: SourceTable[] = []
  const textParts: string[] = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
    const sliced = rows.slice(0, 200)
    if (sliced.length === 0) continue

    tables.push({ sheetName, rows: sliced, sourceFile: fileName })

    // Also produce markdown text for the text block
    const header = sliced[0].join(' | ')
    const sep = sliced[0].map(() => '---').join(' | ')
    const body = sliced.slice(1).map(r => r.join(' | ')).join('\n')
    textParts.push(`### Sheet: ${sheetName}\n| ${header} |\n| ${sep} |\n${body ? body.split('\n').map(r => `| ${r} |`).join('\n') : ''}`)
  }

  return { text: textParts.join('\n\n'), tables }
}

// ─── POST — extract + cache ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const category = (form.get('category') as SourceFile['category']) || 'other'
    const sourceDocId = (form.get('sourceDocId') as string) || ''
    const projectCode = (form.get('projectCode') as string) || ''
    const deliverableRef = (form.get('deliverableRef') as string) || ''
    // preExtractedText: sent by client when PDF was extracted client-side
    const preExtractedText = (form.get('preExtractedText') as string) || ''

    if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 })

    const fileExt = ext(file.name)
    if (!ALLOWED_EXTS.has(fileExt)) {
      return NextResponse.json({ error: 'unsupported_format' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
    }

    // Resolve existing SourceDoc or start fresh
    let doc: SourceDoc | null = null
    let newDocId = sourceDocId

    if (sourceDocId) {
      doc = await getSource(sourceDocId)
      if (!doc) {
        return NextResponse.json({ error: 'cache_miss' }, { status: 410 })
      }
    } else {
      newDocId = `src_${crypto.randomUUID()}`
      doc = { sourceDocId: newDocId, projectCode, deliverableRef, files: [], createdAt: Date.now() }
    }

    // Extract text + tables
    let extractedText = ''
    let tables: SourceTable[] = []
    let pageCount: number | undefined

    if (preExtractedText) {
      // PDF: client-extracted text
      extractedText = preExtractedText
      pageCount = Number(form.get('pageCount') || 0) || undefined
    } else {
      const buf = Buffer.from(await file.arrayBuffer())

      if (fileExt === '.docx' || fileExt === '.doc') {
        const result = await extractDocx(buf)
        extractedText = result.text
        tables = result.tables.map(t => ({ ...t, sourceFile: file.name }))
      } else if (['.xlsx', '.xls', '.csv'].includes(fileExt)) {
        const result = await extractXlsx(buf, file.name)
        extractedText = result.text
        tables = result.tables
      } else {
        // .md, .txt, .json
        extractedText = buf.toString('utf-8')
        if (fileExt === '.json') {
          try { extractedText = JSON.stringify(JSON.parse(extractedText), null, 2) } catch { /* use raw */ }
        }
      }
    }

    const wordCount = extractedText.split(/\s+/).filter(Boolean).length

    const newFile: SourceFile = {
      fileName: file.name,
      category,
      extractedText,
      tables,
      wordCount,
      pageCount,
    }

    // Replace if same filename already present, otherwise append
    const existingIdx = doc.files.findIndex(f => f.fileName === file.name)
    if (existingIdx >= 0) {
      doc.files[existingIdx] = newFile
    } else {
      doc.files.push(newFile)
    }

    await putSource(doc)

    const totalWords = doc.files.reduce((s, f) => s + f.wordCount, 0)
    const totalTables = doc.files.reduce((s, f) => s + f.tables.length, 0)

    return NextResponse.json({
      sourceDocId: newDocId,
      file: {
        fileName: file.name,
        category,
        wordCount,
        pageCount,
        tableCount: tables.length,
        figureCount: 0,
      },
      totalWords,
      totalFiles: doc.files.length,
      totalTables,
    })
  } catch (e) {
    console.error('[deliverable/source] extraction error:', e)
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: 'extraction_failed', detail: msg }, { status: 500 })
  }
}

// ─── DELETE — remove one file from the doc ───────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sourceDocId = searchParams.get('sourceDocId') || ''
    const fileName = searchParams.get('fileName') || ''

    if (!sourceDocId || !fileName) {
      return NextResponse.json({ error: 'sourceDocId and fileName required' }, { status: 400 })
    }

    const updated = await deleteFileFromSource(sourceDocId, fileName)
    if (!updated) {
      return NextResponse.json({ error: 'cache_miss' }, { status: 410 })
    }

    const totalWords = updated.files.reduce((s, f) => s + f.wordCount, 0)
    return NextResponse.json({ sourceDocId, totalFiles: updated.files.length, totalWords })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
