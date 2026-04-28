import type { FigurePage } from './types'

export async function detectAndRasteriseFigures(
  arrayBuffer: ArrayBuffer
): Promise<FigurePage[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const figures: FigurePage[] = []
  const MAX_FIGURES = 8
  const RASTER_DPI = 110

  for (let pageNum = 1; pageNum <= pdf.numPages && figures.length < MAX_FIGURES; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const ops = await page.getOperatorList()
    const opNames = ops.fnArray as number[]

    const OPS = (pdfjsLib as any).OPS
    const paintImageOps = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject]
    const constructPathOps = [OPS.constructPath, OPS.fill, OPS.stroke, OPS.eoFill]

    const imageOpCount = opNames.filter(op => paintImageOps.includes(op)).length
    const drawOpCount = opNames.filter(op => constructPathOps.includes(op)).length

    const isFigureHeavy = imageOpCount >= 1 || drawOpCount >= 80

    if (!isFigureHeavy) continue

    const viewport = page.getViewport({ scale: RASTER_DPI / 72 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, canvas, viewport } as any).promise
    const dataUrl = canvas.toDataURL('image/png')

    const content = await page.getTextContent()
    const items = content.items as { str: string; transform: number[] }[]
    const caption = items
      .filter(i => 'str' in i && /^(figure|fig\.|gantt|pert|diagram)\s*\d/i.test(i.str.trim()))
      .map(i => i.str.trim())[0] ?? null

    const text = items.map(i => ('str' in i ? i.str : '')).join(' ').toLowerCase()
    const hint: FigurePage['hint'] =
      /gantt|month\s*\d+/.test(text) ? 'gantt' :
      /pert|critical\s*path/.test(text) ? 'pert' :
      /architecture|component/.test(text) ? 'architecture' :
      /flow|process/.test(text) ? 'flow' :
      drawOpCount >= 80 ? 'flow' : 'unknown'

    figures.push({
      pageNumber: pageNum,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
      hint,
      caption,
    })
  }

  return figures
}
