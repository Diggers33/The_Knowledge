import type { StructuredTable, StructuredTableRow, TableKind } from './types'

interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

export async function extractTablesFromPdf(
  arrayBuffer: ArrayBuffer
): Promise<StructuredTable[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const tables: StructuredTable[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items as PdfTextItem[]

    const yBands = new Map<number, PdfTextItem[]>()
    for (const item of items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round((item.transform[5] ?? 0) / 2) * 2
      if (!yBands.has(y)) yBands.set(y, [])
      yBands.get(y)!.push(item)
    }

    const sortedYs = [...yBands.keys()].sort((a, b) => b - a)

    const candidates: number[][] = []
    let run: number[] = []
    for (const y of sortedYs) {
      const itemsInRow = yBands.get(y)!
      if (itemsInRow.length >= 3) {
        run.push(y)
      } else {
        if (run.length >= 3) candidates.push(run)
        run = []
      }
    }
    if (run.length >= 3) candidates.push(run)

    for (const cand of candidates) {
      const rowsItems = cand.map(y => yBands.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]))
      const widest = rowsItems.reduce((a, b) => (b.length > a.length ? b : a))
      const colXs = widest.map(it => it.transform[4])

      const rows: StructuredTableRow[] = rowsItems.map(rowItems => {
        const cells: string[] = colXs.map(() => '')
        for (const it of rowItems) {
          let bestIdx = 0
          let bestDist = Infinity
          for (let c = 0; c < colXs.length; c++) {
            const d = Math.abs(it.transform[4] - colXs[c])
            if (d < bestDist) { bestDist = d; bestIdx = c }
          }
          cells[bestIdx] = (cells[bestIdx] + ' ' + it.str).trim()
        }
        return { cells }
      })

      const header = rows.length > 0 && looksLikeHeader(rows[0].cells) ? rows[0].cells : null
      const body = header ? rows.slice(1) : rows
      const kind = classifyTable(header, body)

      const allItems = rowsItems.flat()
      const xs = allItems.map(i => i.transform[4])
      const ys = allItems.map(i => i.transform[5])
      const bbox = {
        x0: Math.min(...xs), y0: Math.min(...ys),
        x1: Math.max(...xs), y1: Math.max(...ys),
      }

      tables.push({ pageNumber: pageNum, header, rows: body, kind, bbox })
    }
  }

  return tables
}

function looksLikeHeader(cells: string[]): boolean {
  const tl = cells.map(c => c.trim()).filter(Boolean)
  if (tl.length < 2) return false
  const titleish = tl.filter(c => /^[A-Z][A-Za-z\s/]+$/.test(c) && c.length < 40).length
  return titleish / tl.length >= 0.6
}

function classifyTable(header: string[] | null, rows: StructuredTableRow[]): TableKind {
  const hdr = (header ?? []).join(' ').toLowerCase()
  const sample = rows.slice(0, 3).flatMap(r => r.cells).join(' ').toLowerCase()
  const blob = hdr + ' ' + sample
  if (/risk|likelihood|severity|mitigation/.test(blob)) return 'risk'
  if (/kpi|target|indicator|baseline/.test(blob)) return 'kpi'
  if (/\bwp\d|work\s*package|lead.*partner|effort.*pm/.test(blob)) return 'wp_summary'
  if (/\bd\d+\.\d|deliverable.*number|deliverable.*title/.test(blob)) return 'deliverable'
  if (/\bm\d+\.\d|milestone.*date|milestone.*means/.test(blob)) return 'milestone'
  if (/participant|partner|country|short\s*name/.test(blob)) return 'partner'
  if (/budget|cost|person.month|euro|€/.test(blob)) return 'budget'
  return 'unknown'
}
