'use client'
import { useState, useRef, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { Loader2, Download, ChevronRight, ChevronLeft, FileText, Check, RefreshCw, Plus, X, Upload, AlertTriangle } from 'lucide-react'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Step = 'setup' | 'write' | 'export'

interface KPI {
  id: string
  description: string
  target: string
  result: string
  status: 'met' | 'partial' | 'missed'
  notes: string
}

type SourceCategory = 'measurements' | 'report' | 'spec' | 'reference' | 'other'

interface SourceFileEntry {
  fileName: string
  category: SourceCategory
  wordCount: number
  pageCount?: number
  tableCount: number
  figureCount: number
  status: 'extracting' | 'ready' | 'failed'
  errorMessage?: string
}

interface DeliverableSetup {
  projectCode: string
  wpNumber: string
  deliverableRef: string
  deliverableTitle: string
  additionalContext: string
  leadBeneficiary: string
  contributingBeneficiaries: string
  dueMonth: string
  actualDeliveryMonth: string
  disseminationLevel: 'PU' | 'SEN' | 'CL'
  nature: 'R' | 'DEM' | 'DEC' | 'DATA' | 'DMP' | 'ETHICS' | 'OTHER'
  version: string
  authors: string
  reviewers: string
  acceptanceCriteria: string
  annexes: string
  sourceDocId: string | null
  sourceFiles: SourceFileEntry[]
}

interface SectionConfig {
  id: string
  label: string
  description: string
  wordTarget: number
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const C = {
  bg:     '#FFFFFF',
  panel:  '#F5F7FF',
  input:  '#EEF1FA',
  border: '#D0D8EE',
  cyan:   '#4A9EFF',
  text:   '#0F1B3D',
  muted:  '#5A6A9A',
  green:  '#16A34A',
  amber:  '#D97706',
  red:    '#DC2626',
}

const SECTIONS: SectionConfig[] = [
  { id: 'executive_summary',  label: 'Executive Summary',       description: 'Objective, scope, key results, and status against plan',       wordTarget: 300 },
  { id: 'methodology',        label: 'Methodology',              description: 'Experimental setup, instruments, protocols, and approach',      wordTarget: 500 },
  { id: 'technical_results',  label: 'Technical Results',        description: 'Specific outcomes, measurements, accuracy figures, TRL status', wordTarget: 600 },
  { id: 'iris_contribution',  label: 'IRIS Contribution',        description: 'What IRIS specifically developed, built, and achieved',         wordTarget: 400 },
  { id: 'validation',         label: 'Validation & KPIs',        description: 'KPI targets vs results, pilot tests, performance benchmarks',   wordTarget: 500 },
  { id: 'conclusions',        label: 'Conclusions & Next Steps', description: 'Key findings, challenges, lessons learned, and next steps',     wordTarget: 400 },
]

const STEPS: Step[] = ['setup', 'write', 'export']
const STEP_LABELS: Record<Step, string> = { setup: 'Setup', write: 'Write', export: 'Export' }

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length

const inputStyle = {
  width: '100%',
  background: C.input,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  fontSize: 14,
  padding: '9px 12px',
  boxSizing: 'border-box' as const,
  fontFamily: 'inherit',
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  color: C.muted,
  marginBottom: 6,
}

// ─── COMPLIANCE ───────────────────────────────────────────────────────────────

function runComplianceChecks(
  setup: DeliverableSetup,
  sections: Record<string, string>,
  kpis: KPI[],
  sectionList: SectionConfig[]
): Array<{ id: string; label: string; pass: boolean; warning?: boolean }> {
  const checks: Array<{ id: string; label: string; pass: boolean; warning?: boolean }> = []

  // 1. Header complete
  checks.push({
    id: 'header',
    label: 'Annex 1 header complete (dissemination level, nature, version set)',
    pass: !!(setup.disseminationLevel && setup.nature && setup.version),
  })

  // 2. KPI table present
  const kpisFull = kpis.filter(k => k.description && k.target && k.result && k.status)
  checks.push({
    id: 'kpis',
    label: 'KPI table: at least one complete row',
    pass: kpisFull.length > 0,
    warning: kpis.length > 0 && kpisFull.length < kpis.length,
  })

  // 3. Acceptance criteria addressed in conclusions
  const criteriaLines = setup.acceptanceCriteria.split('\n').map(s => s.trim()).filter(Boolean)
  const conclusionsText = (sections['conclusions'] || '').toLowerCase()
  const criteriaAddressed = criteriaLines.length === 0 || criteriaLines.every(c => {
    const kw = c.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 3)
    return kw.some(w => conclusionsText.includes(w))
  })
  checks.push({
    id: 'criteria',
    label: 'Acceptance criteria addressed in Conclusions',
    pass: criteriaAddressed,
    warning: criteriaLines.length === 0,
  })

  // 4. Length sanity
  const lengthOk = sectionList.every(sec => {
    const text = sections[sec.id] || ''
    if (!text.trim()) return true
    const wc = text.split(/\s+/).filter(Boolean).length
    return wc >= sec.wordTarget * 0.8 && wc <= sec.wordTarget * 1.3
  })
  checks.push({ id: 'length', label: 'All sections within ±20–30% of target word count', pass: lengthOk })

  // 5. No placeholder tokens
  const allText = Object.values(sections).join(' ')
  const hasPlaceholders = /\bXYZ\b|\bpartner\s+X\b|<INSERT|<TBD>|\[TBD\]|\[INSERT/i.test(allText)
  checks.push({ id: 'placeholders', label: 'No placeholder tokens (XYZ, <TBD>, partner X)', pass: !hasPlaceholders })

  // 6. AI footer (always present in DOCX)
  checks.push({ id: 'footer', label: 'AI-disclosure footer included in DOCX', pass: true })

  // 7. Page count plausible
  const totalWords = Object.values(sections).reduce((s, t) => s + t.split(/\s+/).filter(Boolean).length, 0)
  const estPages = totalWords / 400
  checks.push({
    id: 'pages',
    label: `Page count plausible (est. ${estPages.toFixed(1)} pages; target 8–25)`,
    pass: estPages >= 5 && estPages <= 30,
    warning: estPages < 8 || estPages > 25,
  })

  // P1-C: Prompt-echo guard (mirrors server-side PROMPT_ECHO_PATTERNS)
  const PROMPT_ECHO_PATTERNS = [
    /^Deliverable:\s+D\d/i,
    /^Project:\s+\w+\s*\|\s*Work Package:/im,
    /\bACCEPTANCE CRITERIA \(address each one\)/i,
    /^Task:\s*Write/im,
    /Write approximately \d+ words\.?\s*$/im,
    /^Additional Context:/im,
    /=== METADATA ===|=== PRIMARY SOURCE MATERIAL ===|=== SECONDARY CONTEXT/i,
    /Begin the section now\. Do not echo/i,
    /^#+\s*Your Task/m,
    /^#+\s*Relevant Document Chunks/m,
    /Target length:\s+approximately \d+ words/m,
  ]
  const failingSections = Object.entries(sections)
    .filter(([, text]) => {
      const head = text.slice(0, 300)
      return PROMPT_ECHO_PATTERNS.some(re => re.test(head))
    })
    .map(([id]) => id)
  checks.push({
    id: 'no_system_leak',
    label: failingSections.length > 0
      ? `Prompt-template tokens in output — check: ${failingSections.join(', ')}`
      : 'No prompt-template or scaffold tokens in output',
    pass: failingSections.length === 0,
  })

  // P1-D: No foreign organisation tokens
  const ALLOWED_ACRONYMS = new Set(['EU', 'EC', 'RI', 'RD', 'AI', 'ML', 'SSH', 'KER', 'WP', 'IPR', 'FAIR', 'RDM', 'GDPR', 'TRL', 'SME', 'HEI', 'RTO', 'PU', 'SEN', 'CL', 'DMP', 'IRIS'])
  const consortiumAcronyms = new Set([
    setup.projectCode.toUpperCase(),
    ...setup.contributingBeneficiaries.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    setup.leadBeneficiary.trim().toUpperCase(),
  ])
  const upperTokens = allText.match(/\b[A-Z]{2,8}\b/g) || []
  const foreignOrgs = upperTokens.filter(t => !ALLOWED_ACRONYMS.has(t) && !consortiumAcronyms.has(t))
  const uniqueForeign = [...new Set(foreignOrgs)]
  checks.push({
    id: 'no_foreign_orgs',
    label: uniqueForeign.length > 0
      ? `Foreign org tokens detected: ${uniqueForeign.slice(0, 5).join(', ')}${uniqueForeign.length > 5 ? '…' : ''}`
      : 'No foreign organisation tokens detected',
    pass: uniqueForeign.length === 0,
    warning: uniqueForeign.length > 0,
  })

  return checks
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DeliverablePage() {
  const [step, setStep] = useState<Step>('setup')
  const [setup, setSetup] = useState<DeliverableSetup>({
    projectCode: '',
    wpNumber: 'WP1',
    deliverableRef: 'D1.1',
    deliverableTitle: '',
    additionalContext: '',
    leadBeneficiary: '',
    contributingBeneficiaries: '',
    dueMonth: '',
    actualDeliveryMonth: '',
    disseminationLevel: 'PU',
    nature: 'R',
    version: '1.0',
    authors: '',
    reviewers: '',
    acceptanceCriteria: '',
    annexes: '',
    sourceDocId: null,
    sourceFiles: [],
  })
  const [sourceCacheMiss, setSourceCacheMiss] = useState(false)
  const [sections, setSections] = useState<Record<string, string>>({})
  const [kpis, setKpis] = useState<KPI[]>([])
  const [generating, setGenerating] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('executive_summary')
  const [exporting, setExporting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // ── KPI helpers ─────────────────────────────────────────────────────────────

  const addKpi = useCallback(() => {
    setKpis(prev => [...prev, { id: `KPI-${prev.length + 1}`, description: '', target: '', result: '', status: 'met', notes: '' }])
  }, [])

  const updateKpi = useCallback((index: number, field: keyof KPI, value: string) => {
    setKpis(prev => prev.map((k, i) => i === index ? { ...k, [field]: value } : k))
  }, [])

  const removeKpi = useCallback((index: number) => {
    setKpis(prev => prev.filter((_, i) => i !== index))
  }, [])

  // ── Source upload ───────────────────────────────────────────────────────────

  const handleSourceFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, 10)
    const ALLOWED_EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.md', '.txt', '.json']
    const MAX_BYTES = 30 * 1024 * 1024

    for (const file of fileArray) {
      const fileExt = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!ALLOWED_EXTS.includes(fileExt)) continue
      if (file.size > MAX_BYTES) {
        setSetup(p => ({
          ...p,
          sourceFiles: [...p.sourceFiles.filter(f => f.fileName !== file.name), {
            fileName: file.name, category: 'other', wordCount: 0, tableCount: 0, figureCount: 0,
            status: 'failed', errorMessage: 'File exceeds 30 MB limit',
          }],
        }))
        continue
      }

      setSetup(p => ({
        ...p,
        sourceFiles: [...p.sourceFiles.filter(f => f.fileName !== file.name), {
          fileName: file.name, category: 'other', wordCount: 0, tableCount: 0, figureCount: 0, status: 'extracting',
        }],
      }))

      try {
        const form = new FormData()
        let preExtractedText = ''
        let pageCount = 0

        if (fileExt === '.pdf') {
          // Client-side PDF extraction (mirrors proposal upload pattern)
          const ab = await file.arrayBuffer()
          const pdfjsLib = await import('pdfjs-dist')
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise
          pageCount = pdf.numPages
          const pages: string[] = []
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const content = await page.getTextContent()
            pages.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(' '))
          }
          preExtractedText = pages.join('\n\n')
          form.append('preExtractedText', preExtractedText)
          form.append('pageCount', String(pageCount))
        }

        form.append('file', file)
        form.append('category', 'other')
        form.append('sourceDocId', setup.sourceDocId || '')
        form.append('projectCode', setup.projectCode.toUpperCase())
        form.append('deliverableRef', setup.deliverableRef)

        const res = await fetch('/api/deliverable/source', { method: 'POST', body: form })
        if (res.status === 410) { setSourceCacheMiss(true); return }
        if (!res.ok) throw new Error((await res.json()).error || 'extraction_failed')

        const data = await res.json()
        setSetup(p => ({
          ...p,
          sourceDocId: data.sourceDocId,
          sourceFiles: p.sourceFiles.map(f => f.fileName === file.name
            ? { ...f, status: 'ready', wordCount: data.file.wordCount, tableCount: data.file.tableCount, pageCount: data.file.pageCount }
            : f
          ),
        }))
      } catch (e: any) {
        setSetup(p => ({
          ...p,
          sourceFiles: p.sourceFiles.map(f => f.fileName === file.name
            ? { ...f, status: 'failed', errorMessage: e.message || 'Extraction failed' }
            : f
          ),
        }))
      }
    }
  }, [setup.sourceDocId, setup.projectCode, setup.deliverableRef])

  const updateSourceCategory = useCallback((fileName: string, category: SourceCategory) => {
    setSetup(p => ({
      ...p,
      sourceFiles: p.sourceFiles.map(f => f.fileName === fileName ? { ...f, category } : f),
    }))
  }, [])

  const removeSourceFile = useCallback(async (fileName: string) => {
    if (setup.sourceDocId) {
      await fetch(`/api/deliverable/source?sourceDocId=${encodeURIComponent(setup.sourceDocId)}&fileName=${encodeURIComponent(fileName)}`, { method: 'DELETE' })
    }
    setSetup(p => ({ ...p, sourceFiles: p.sourceFiles.filter(f => f.fileName !== fileName) }))
  }, [setup.sourceDocId])

  // ── Generation ──────────────────────────────────────────────────────────────

  const generateSection = useCallback(async (sectionId: string) => {
    if (generating) return
    setGenerating(sectionId)
    setActiveSection(sectionId)
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/deliverable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          section: sectionId,
          projectCode: setup.projectCode.toUpperCase(),
          wpNumber: setup.wpNumber,
          deliverableRef: setup.deliverableRef,
          deliverableTitle: setup.deliverableTitle,
          additionalContext: setup.additionalContext,
          acceptanceCriteria: setup.acceptanceCriteria.split('\n').map(s => s.trim()).filter(Boolean),
          sourceDocId: setup.sourceDocId ?? undefined,
        }),
      })

      if (res.status === 410) { setSourceCacheMiss(true); return }
      if (!res.ok) throw new Error(await res.text())
      const text = await res.text()
      setSections(prev => ({ ...prev, [sectionId]: text }))
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e)
    } finally {
      setGenerating(null)
    }
  }, [generating, setup])

  const generateAll = useCallback(async () => {
    for (const sec of SECTIONS) {
      await generateSection(sec.id)
    }
  }, [generateSection])

  // ── Export ──────────────────────────────────────────────────────────────────

  const exportDocx = useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/deliverable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputType: 'docx',
          projectCode: setup.projectCode.toUpperCase(),
          wpNumber: setup.wpNumber,
          deliverableRef: setup.deliverableRef,
          deliverableTitle: setup.deliverableTitle,
          generatedSections: sections,
          leadBeneficiary: setup.leadBeneficiary,
          contributingBeneficiaries: setup.contributingBeneficiaries.split(',').map(s => s.trim()).filter(Boolean),
          dueMonth: setup.dueMonth ? Number(setup.dueMonth) : undefined,
          actualDeliveryMonth: setup.actualDeliveryMonth ? Number(setup.actualDeliveryMonth) : undefined,
          disseminationLevel: setup.disseminationLevel,
          nature: setup.nature,
          version: setup.version,
          authors: setup.authors.split(',').map(s => s.trim()).filter(Boolean),
          reviewers: setup.reviewers.split(',').map(s => s.trim()).filter(Boolean),
          kpis,
          acceptanceCriteria: setup.acceptanceCriteria.split('\n').map(s => s.trim()).filter(Boolean),
          annexes: setup.annexes.split('\n').map(line => {
            const [label, location] = line.split('|').map(s => s.trim())
            return { label: label || line, location: location || '' }
          }).filter(a => a.label),
        }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${setup.projectCode}_${setup.deliverableRef.replace('.', '-')}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setExporting(false)
    }
  }, [setup, sections, kpis])

  const completedCount = SECTIONS.filter(s => sections[s.id]?.trim()).length
  const canProceed = setup.projectCode.trim() && setup.deliverableTitle.trim()

  // Compliance checks (used in export step)
  const complianceChecks = runComplianceChecks(setup, sections, kpis, SECTIONS)
  const hasBlockingFailure = complianceChecks.some(c => !c.pass && !c.warning)

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar role="manager" />
      <div style={{ flex: 1, marginLeft: 220, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 32px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <FileText size={22} color={C.cyan} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>Deliverable Writer</h1>
            {setup.deliverableRef && setup.deliverableTitle && (
              <span style={{ fontSize: 13, color: C.muted, marginLeft: 8 }}>
                {setup.deliverableRef} — {setup.deliverableTitle}
              </span>
            )}
          </div>

          {/* Step nav */}
          <div style={{ display: 'flex', gap: 0 }}>
            {STEPS.map((s, i) => (
              <button key={s} onClick={() => setStep(s)}
                style={{
                  padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: step === s ? `2px solid ${C.cyan}` : '2px solid transparent',
                  color: step === s ? C.cyan : C.muted, fontSize: 13, fontWeight: step === s ? 600 : 400,
                }}>
                <span style={{ marginRight: 6, opacity: 0.5 }}>{i + 1}.</span>{STEP_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>

          {/* ── SETUP ── */}
          {step === 'setup' && (
            <div style={{ maxWidth: 740 }}>
              <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>
                Enter the deliverable details. The writer will pull context from the IRIS knowledge base automatically.
              </p>

              {/* Core fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <Field label="Project Code *" value={setup.projectCode}
                  onChange={v => setSetup(p => ({ ...p, projectCode: v.toUpperCase() }))}
                  placeholder="e.g. NANOBLOC" />
                <Field label="Work Package" value={setup.wpNumber}
                  onChange={v => setSetup(p => ({ ...p, wpNumber: v }))}
                  placeholder="e.g. WP3" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>
                <Field label="Deliverable Ref *" value={setup.deliverableRef}
                  onChange={v => setSetup(p => ({ ...p, deliverableRef: v }))}
                  placeholder="e.g. D3.2" />
                <Field label="Deliverable Title *" value={setup.deliverableTitle}
                  onChange={v => setSetup(p => ({ ...p, deliverableTitle: v }))}
                  placeholder="e.g. NIR Sensor Prototype — Validation Report" />
              </div>

              <div style={{ marginBottom: 28 }}>
                <label style={labelStyle}>Additional Context (optional)</label>
                <textarea value={setup.additionalContext}
                  onChange={e => setSetup(p => ({ ...p, additionalContext: e.target.value }))}
                  rows={5}
                  placeholder="Paste WP description, task objectives, KPIs, or any specific results to include..."
                  style={{ ...inputStyle, resize: 'vertical' }} />
              </div>

              {/* Source Material Upload */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24, marginBottom: 28 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4, marginTop: 0 }}>
                  Source Material
                </p>
                <p style={{ fontSize: 12, color: C.muted, marginBottom: 14, marginTop: 0 }}>
                  Upload the lab data, internal reports, specs, and KPI sheets this deliverable should be written from. The writer will use these as the primary evidence.
                </p>

                {sourceCacheMiss && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, background: 'rgba(217,119,6,0.08)', border: `1px solid ${C.amber}`, borderRadius: 8, color: C.amber, fontSize: 12 }}>
                    <AlertTriangle size={14} />
                    Source files were uploaded earlier but the server has cleared them. Re-upload to continue.
                  </div>
                )}

                {/* Drop zone */}
                <label style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '18px 20px', marginBottom: 12,
                  border: `2px dashed ${setup.sourceFiles.length > 0 ? C.cyan : C.border}`,
                  borderRadius: 9, cursor: 'pointer', background: C.input,
                  color: C.muted, fontSize: 13, textAlign: 'center',
                }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleSourceFiles(e.dataTransfer.files) }}
                >
                  <input type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.txt,.json"
                    style={{ display: 'none' }}
                    onChange={e => { if (e.target.files) handleSourceFiles(e.target.files) }} />
                  <Upload size={18} color={C.cyan} />
                  <span>Drop files here, or click to upload</span>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>PDF, DOCX, XLSX, CSV, TXT, MD — up to 30 MB each, max 10 files</span>
                </label>

                {/* File rows */}
                {setup.sourceFiles.length === 0 && (
                  <p style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', margin: 0 }}>
                    Optional but strongly recommended — sections will be much stronger with source files attached.
                  </p>
                )}

                {setup.sourceFiles.map(f => (
                  <div key={f.fileName} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px', marginBottom: 6,
                    background: f.status === 'failed' ? 'rgba(220,38,38,0.05)' : C.panel,
                    border: `1px solid ${f.status === 'failed' ? C.red : C.border}`,
                    borderRadius: 8,
                  }}>
                    {f.status === 'extracting'
                      ? <Loader2 size={15} color={C.cyan} style={{ animation: 'spin 1s linear infinite', marginTop: 2, flexShrink: 0 }} />
                      : f.status === 'failed'
                      ? <X size={15} color={C.red} style={{ marginTop: 2, flexShrink: 0 }} />
                      : <Check size={15} color={C.green} style={{ marginTop: 2, flexShrink: 0 }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fileName}</div>
                      {f.status === 'extracting' && <div style={{ fontSize: 11, color: C.muted }}>Extracting…</div>}
                      {f.status === 'ready' && (
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {f.wordCount.toLocaleString()} words{f.tableCount > 0 ? ` · ${f.tableCount} tables` : ''}{f.pageCount ? ` · ${f.pageCount} pages` : ''}
                        </div>
                      )}
                      {f.status === 'failed' && <div style={{ fontSize: 11, color: C.red }}>{f.errorMessage || 'Extraction failed'}</div>}
                    </div>
                    {f.status === 'ready' && (
                      <select
                        value={f.category}
                        onChange={e => updateSourceCategory(f.fileName, e.target.value as SourceCategory)}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.input, color: C.text, flexShrink: 0 }}
                      >
                        <option value="measurements">measurements</option>
                        <option value="report">report</option>
                        <option value="spec">spec</option>
                        <option value="reference">reference</option>
                        <option value="other">other</option>
                      </select>
                    )}
                    <button onClick={() => removeSourceFile(f.fileName)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.muted, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}

                {setup.sourceFiles.filter(f => f.status === 'ready').length > 0 && (
                  <p style={{ fontSize: 11, color: C.cyan, margin: '8px 0 0' }}>
                    {setup.sourceFiles.filter(f => f.status === 'ready').length} files ·{' '}
                    {setup.sourceFiles.filter(f => f.status === 'ready').reduce((s, f) => s + f.wordCount, 0).toLocaleString()} words extracted ·{' '}
                    {setup.sourceFiles.filter(f => f.status === 'ready').reduce((s, f) => s + f.tableCount, 0)} tables
                  </p>
                )}
              </div>

              {/* Annex 1 Metadata */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24, marginBottom: 24 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 18, marginTop: 0 }}>
                  Annex 1 Metadata
                </p>

                {/* Row 1: Lead Beneficiary, Dissemination Level, Nature */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <Field label="Lead Beneficiary" value={setup.leadBeneficiary}
                    onChange={v => setSetup(p => ({ ...p, leadBeneficiary: v }))}
                    placeholder="e.g. IRIS" />
                  <div>
                    <label style={labelStyle}>Dissemination Level</label>
                    <select value={setup.disseminationLevel}
                      onChange={e => setSetup(p => ({ ...p, disseminationLevel: e.target.value as DeliverableSetup['disseminationLevel'] }))}
                      style={inputStyle}>
                      <option value="PU">PU — Public</option>
                      <option value="SEN">SEN — Sensitive</option>
                      <option value="CL">CL — Classified</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Nature</label>
                    <select value={setup.nature}
                      onChange={e => setSetup(p => ({ ...p, nature: e.target.value as DeliverableSetup['nature'] }))}
                      style={inputStyle}>
                      <option value="R">R — Report</option>
                      <option value="DEM">DEM — Demonstrator</option>
                      <option value="DEC">DEC — Websites/Patents</option>
                      <option value="DATA">DATA — Dataset</option>
                      <option value="DMP">DMP — Data Mgmt Plan</option>
                      <option value="ETHICS">ETHICS — Ethics</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: Version, Due Month, Actual Delivery Month */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <Field label="Version" value={setup.version}
                    onChange={v => setSetup(p => ({ ...p, version: v }))}
                    placeholder="e.g. 1.0" />
                  <Field label="Due Month" value={setup.dueMonth}
                    onChange={v => setSetup(p => ({ ...p, dueMonth: v }))}
                    placeholder="e.g. 18" />
                  <Field label="Actual Delivery Month" value={setup.actualDeliveryMonth}
                    onChange={v => setSetup(p => ({ ...p, actualDeliveryMonth: v }))}
                    placeholder="e.g. 19, if late" />
                </div>

                {/* Row 3: Authors, Reviewers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <Field label="Authors" value={setup.authors}
                    onChange={v => setSetup(p => ({ ...p, authors: v }))}
                    placeholder="comma-separated" />
                  <Field label="Reviewers" value={setup.reviewers}
                    onChange={v => setSetup(p => ({ ...p, reviewers: v }))}
                    placeholder="comma-separated" />
                </div>

                {/* Row 4: Contributing Beneficiaries */}
                <div style={{ marginBottom: 16 }}>
                  <Field label="Contributing Beneficiaries" value={setup.contributingBeneficiaries}
                    onChange={v => setSetup(p => ({ ...p, contributingBeneficiaries: v }))}
                    placeholder="comma-separated" />
                </div>

                {/* Row 5: Acceptance Criteria */}
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Acceptance Criteria</label>
                  <textarea value={setup.acceptanceCriteria}
                    onChange={e => setSetup(p => ({ ...p, acceptanceCriteria: e.target.value }))}
                    rows={4}
                    placeholder="One criterion per line — paste from DoA"
                    style={{ ...inputStyle, resize: 'vertical' }} />
                </div>

                {/* Row 6: Annexes */}
                <div style={{ marginBottom: 24 }}>
                  <label style={labelStyle}>Annexes</label>
                  <textarea value={setup.annexes}
                    onChange={e => setSetup(p => ({ ...p, annexes: e.target.value }))}
                    rows={3}
                    placeholder="One per line: Label | /path/to/file.xlsx"
                    style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
              </div>

              {/* KPI Editor */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24, marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>KPIs</p>
                  <button onClick={addKpi}
                    style={{
                      padding: '6px 14px', background: C.input, border: `1px solid ${C.border}`, borderRadius: 6,
                      color: C.text, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                    <Plus size={13} /> Add KPI
                  </button>
                </div>

                {kpis.length === 0 && (
                  <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>No KPIs added. Click "Add KPI" to define performance indicators.</p>
                )}

                {kpis.map((kpi, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 110px 28px',
                    gap: 8, marginBottom: 8, alignItems: 'start',
                  }}>
                    <input value={kpi.id}
                      onChange={e => updateKpi(i, 'id', e.target.value)}
                      placeholder="KPI-1"
                      style={{ ...inputStyle, padding: '7px 8px' }} />
                    <input value={kpi.description}
                      onChange={e => updateKpi(i, 'description', e.target.value)}
                      placeholder="Description"
                      style={{ ...inputStyle, padding: '7px 8px' }} />
                    <input value={kpi.target}
                      onChange={e => updateKpi(i, 'target', e.target.value)}
                      placeholder="Target"
                      style={{ ...inputStyle, padding: '7px 8px' }} />
                    <input value={kpi.result}
                      onChange={e => updateKpi(i, 'result', e.target.value)}
                      placeholder="Result"
                      style={{ ...inputStyle, padding: '7px 8px' }} />
                    <select value={kpi.status}
                      onChange={e => updateKpi(i, 'status', e.target.value as KPI['status'])}
                      style={{ ...inputStyle, padding: '7px 8px' }}>
                      <option value="met">Met</option>
                      <option value="partial">Partial</option>
                      <option value="missed">Missed</option>
                    </select>
                    <button onClick={() => removeKpi(i)}
                      style={{ padding: '7px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <button onClick={() => setStep('write')} disabled={!canProceed}
                  style={{
                    padding: '10px 28px', background: canProceed ? C.cyan : C.border,
                    color: canProceed ? '#0B1220' : C.muted, border: 'none', borderRadius: 8,
                    cursor: canProceed ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 14,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                  Continue to Write <ChevronRight size={16} />
                </button>
                {setup.sourceFiles.filter(f => f.status === 'ready').length === 0 && canProceed && (
                  <span style={{ fontSize: 12, color: C.amber, maxWidth: 400 }}>
                    No source material uploaded — sections will rely on IRIS KB retrieval only and may be generic. Recommended: upload at least the WP test report or KPI spreadsheet.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── WRITE ── */}
          {step === 'write' && (
            <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 160px)' }}>

              {/* Section list */}
              <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={generateAll} disabled={!!generating}
                  style={{
                    padding: '9px 14px', background: C.cyan, color: '#0B1220', border: 'none',
                    borderRadius: 8, cursor: generating ? 'not-allowed' : 'pointer', fontWeight: 700,
                    fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                    opacity: generating ? 0.6 : 1,
                  }}>
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  Generate All
                </button>

                {SECTIONS.map(sec => {
                  const done = !!sections[sec.id]?.trim()
                  const active = activeSection === sec.id
                  const isGenerating = generating === sec.id
                  return (
                    <button key={sec.id} onClick={() => { setActiveSection(sec.id); if (!done && !generating) generateSection(sec.id) }}
                      style={{
                        padding: '10px 12px', background: active ? C.input : 'transparent',
                        border: `1px solid ${active ? C.cyan : C.border}`, borderRadius: 8,
                        color: done ? C.text : C.muted, cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                      {isGenerating ? <Loader2 size={14} color={C.cyan} /> :
                        done ? <Check size={14} color={C.green} /> :
                        <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1px solid ${C.border}` }} />}
                      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{sec.label}</span>
                    </button>
                  )
                })}

                <div style={{ marginTop: 'auto', padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 12, color: C.muted }}>{completedCount}/{SECTIONS.length} sections</div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 6 }}>
                    <div style={{ height: '100%', background: C.cyan, borderRadius: 2, width: `${(completedCount / SECTIONS.length) * 100}%`, transition: 'width 0.3s' }} />
                  </div>
                </div>
              </div>

              {/* Editor */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {(() => {
                  const sec = SECTIONS.find(s => s.id === activeSection)!
                  const text = sections[activeSection] || ''
                  const wc = wordCount(text)
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div>
                          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{sec.label}</h2>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{sec.description}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, color: wc >= sec.wordTarget * 0.8 ? C.green : C.muted }}>
                            {wc} / ~{sec.wordTarget} words
                          </span>
                          <button onClick={() => generateSection(activeSection)} disabled={!!generating}
                            style={{
                              padding: '6px 12px', background: 'transparent', border: `1px solid ${C.border}`,
                              borderRadius: 6, color: C.muted, cursor: generating ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                            }}>
                            <RefreshCw size={13} /> Regenerate
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={generating === activeSection ? text + '▋' : text}
                        onChange={e => setSections(prev => ({ ...prev, [activeSection]: e.target.value }))}
                        readOnly={!!generating}
                        style={{
                          flex: 1, background: C.input, border: `1px solid ${C.border}`, borderRadius: 8,
                          color: C.text, fontSize: 14, padding: '16px', resize: 'none',
                          lineHeight: 1.7, fontFamily: 'inherit',
                        }} />
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          {/* ── EXPORT ── */}
          {step === 'export' && (
            <div style={{ maxWidth: 640 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Export Deliverable</h2>
              <p style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>
                {completedCount} of {SECTIONS.length} sections generated. Review the compliance checks below before downloading.
              </p>

              {/* Compliance card */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 28 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 14px' }}>Pre-export Compliance</p>
                {complianceChecks.map(chk => {
                  const icon = chk.pass
                    ? <Check size={14} color={C.green} />
                    : chk.warning
                      ? <span style={{ fontSize: 13, color: C.amber }}>!</span>
                      : <X size={14} color={C.red} />
                  const labelColor = chk.pass ? C.text : chk.warning ? C.amber : C.red
                  return (
                    <div key={chk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                      <span style={{ fontSize: 13, color: labelColor }}>{chk.label}</span>
                    </div>
                  )
                })}
              </div>

              {/* Section list */}
              {SECTIONS.map(sec => (
                <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                  {sections[sec.id] ? <Check size={16} color={C.green} /> : <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}` }} />}
                  <span style={{ flex: 1, fontSize: 14, color: sections[sec.id] ? C.text : C.muted }}>{sec.label}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{wordCount(sections[sec.id] || '')} words</span>
                </div>
              ))}

              <button
                onClick={exportDocx}
                disabled={exporting || completedCount === 0 || hasBlockingFailure}
                style={{
                  marginTop: 28, padding: '12px 28px', background: C.cyan, color: '#0B1220',
                  border: 'none', borderRadius: 8, cursor: (exporting || completedCount === 0 || hasBlockingFailure) ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10,
                  opacity: (completedCount === 0 || hasBlockingFailure) ? 0.5 : 1,
                }}>
                {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                Download DOCX
              </button>
              {hasBlockingFailure && (
                <p style={{ fontSize: 12, color: C.red, marginTop: 8 }}>
                  Fix the failing compliance checks before downloading.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        {step !== 'setup' && (
          <div style={{ padding: '16px 32px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}
              style={{ padding: '8px 20px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <ChevronLeft size={16} /> Back
            </button>
            {step !== 'export' && (
              <button onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}
                style={{ padding: '8px 20px', background: C.cyan, color: '#0B1220', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                {step === 'write' ? 'Export' : 'Next'} <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── FIELD COMPONENT ──────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', background: C.input, border: `1px solid ${C.border}`,
          borderRadius: 8, color: C.text, fontSize: 14, padding: '9px 12px', boxSizing: 'border-box',
          fontFamily: 'inherit',
        }} />
    </div>
  )
}
