'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Loader2, Download, ChevronRight, ChevronLeft, Scale, Check, X, RefreshCw, AlertTriangle, Upload, ChevronDown } from 'lucide-react'
import { getCriteria } from '@/lib/evaluator/criteria'
import type { ActionType, CriterionId } from '@/lib/evaluator/criteria'
import { emptyCallTopic, isTopicLoaded } from '@/lib/evaluator/call-topic'
import type { CallTopic } from '@/lib/evaluator/call-topic'
import type { ProposalDocument } from '@/lib/evaluator/types'

// ─── COLOUR PALETTE ───────────────────────────────────────────────────────────

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
  white:  '#FFFFFF',
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Step = 'setup' | 'evaluate' | 'export'

interface Setup {
  proposalText: string
  proposalRef: string
  actionType: ActionType
  post2026: boolean
  partners: string
  thresholds: { individual: number; total: number }
  sshRequired: boolean
  aiRequired: boolean
  dnshRequired: boolean
  docId: string | null
}

interface EvidenceDensitySignal {
  name: string
  count: number
  weight: number
  cappedAt: number
  source?: 'table' | 'regex'
}

interface CriterionResult {
  criterion: string
  score: number
  comment: string
  aspects: Array<{
    aspectId: string
    evidencePointers?: string[]
    strengths?: string[]
    shortcomings?: Array<{ severity: string; text: string }>
    topicAnchor?: string
    aspectScore?: number
    scoreSource?: 'computed' | 'comparative-ensemble' | 'judgement'
    scoreJustification?: string
    evidenceDensitySignals?: EvidenceDensitySignal[]
    scoreSamples?: number[]
    scoreStdDev?: number
  }>
  flags: string[]
}

// ─── SHARED INPUT STYLE ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.input,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  fontSize: 14,
  padding: '9px 12px',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: C.muted,
  marginBottom: 6,
}

const STEPS: Step[] = ['setup', 'evaluate', 'export']
const STEP_LABELS: Record<Step, string> = { setup: 'Setup', evaluate: 'Evaluate', export: 'Export' }

const CRITERION_DISPLAY: Record<CriterionId, string> = {
  excellence: 'Excellence',
  impact: 'Impact',
  implementation: 'Implementation',
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function EvaluatePage() {
  const [step, setStep] = useState<Step>('setup')
  const [setup, setSetup] = useState<Setup>({
    proposalText: '',
    proposalRef: '',
    actionType: 'RIA',
    post2026: false,
    partners: '',
    thresholds: { individual: 3.0, total: 10.0 },
    sshRequired: false,
    aiRequired: false,
    dnshRequired: false,
    docId: null,
  })
  const [cacheMiss, setCacheMiss] = useState(false)
  const [callTopic, setCallTopic] = useState<CallTopic>(emptyCallTopic())
  const [topicPanelOpen, setTopicPanelOpen] = useState(false)
  const [results, setResults] = useState<Record<string, CriterionResult>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadInfo, setUploadInfo] = useState<{ wordCount: number; sectionsFound: string[]; tableCount: number; figureCount: number } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [proposal, setProposal] = useState<ProposalDocument | null>(null)

  async function extractPdfMultimodal(file: File): Promise<ProposalDocument> {
    const arrayBuffer = await file.arrayBuffer()
    // Each pdfjs.getDocument() call detaches the ArrayBuffer it receives, so we
    // must pass distinct copies to each of the three extraction passes.
    const ab1 = arrayBuffer.slice(0)
    const ab2 = arrayBuffer.slice(0)
    const ab3 = arrayBuffer.slice(0)

    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab1) }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item: any) => ('str' in item ? item.str : '')).join(' '))
    }
    const text = pages.join('\n\n')

    const { extractTablesFromPdf } = await import('@/lib/evaluator/pdf-structured')
    const { detectAndRasteriseFigures } = await import('@/lib/evaluator/figure-detect')
    const tables = await extractTablesFromPdf(ab2)
    const figures = await detectAndRasteriseFigures(ab3)

    return { text, tables, figures, meta: { pageCount: pdf.numPages, extractionVersion: 'v2', isDocx: false } }
  }

  async function extractDocxMultimodal(file: File): Promise<ProposalDocument> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/proposal/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')
    return { text: data.text, tables: [], figures: [], meta: { pageCount: 0, extractionVersion: 'v2', isDocx: true } }
  }

  async function handleFileUpload(file: File) {
    setUploading(true)
    setUploadError('')
    setUploadInfo(null)
    setCacheMiss(false)
    setSetup(p => ({ ...p, docId: null }))
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      const doc = isPdf ? await extractPdfMultimodal(file) : await extractDocxMultimodal(file)

      // Cache the ProposalDocument server-side; subsequent /api/evaluate calls send only docId
      const cacheRes = await fetch('/api/proposal/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: doc }),
      })
      if (!cacheRes.ok) {
        const errBody = await cacheRes.text()
        throw new Error(`Cache failed (${cacheRes.status}): ${errBody.slice(0, 200)}`)
      }
      const { docId, stats } = (await cacheRes.json()) as { docId: string; stats: { tableCount: number; figureCount: number } }

      const text = doc.text
      const wordCount = text.split(/\s+/).filter(Boolean).length
      const sectionsFound: string[] = []
      const headingPattern = /(?:^|\n)(\d+\.?\d*\.?\s+[A-Z][^\n]{3,60})/g
      let m: RegExpExecArray | null
      while ((m = headingPattern.exec(text)) !== null) {
        sectionsFound.push(m[1].trim())
        if (sectionsFound.length >= 20) break
      }

      setProposal(doc)
      setSetup(p => ({ ...p, proposalText: text, docId }))
      setUploadInfo({ wordCount, sectionsFound, tableCount: stats.tableCount, figureCount: stats.figureCount })
      if (!setup.proposalRef.trim()) {
        const name = file.name.replace(/\.(pdf|docx?)$/i, '').replace(/[_\s]+/g, '-').toUpperCase().slice(0, 30)
        setSetup(p => ({ ...p, proposalRef: name }))
      }
    } catch (e: any) {
      setUploadError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function updateTopicConditions(patch: Partial<CallTopic['specificConditions']>) {
    setCallTopic(prev => {
      const cond = { ...prev.specificConditions, ...patch }
      // auto-sync setup flags
      if ('requiresSSH' in patch) setSetup(s => ({ ...s, sshRequired: cond.requiresSSH }))
      if ('requiresAIRobustness' in patch) setSetup(s => ({ ...s, aiRequired: cond.requiresAIRobustness }))
      if ('requiresDNSH' in patch) setSetup(s => ({ ...s, dnshRequired: cond.requiresDNSH }))
      return { ...prev, specificConditions: cond }
    })
  }

  const criteriaIds = getCriteria(setup.actionType)
  const completedCount = criteriaIds.filter(c => results[c]).length
  const canProceed = setup.proposalText.trim().length > 0 && setup.proposalRef.trim().length > 0

  // ── Generate ─────────────────────────────────────────────────────────────────

  async function generateCriterion(criterion: string) {
    setGenerating(criterion)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ier',
          proposalText: setup.proposalText.slice(0, 20000),
          docId: setup.docId ?? undefined,
          criterion,
          actionType: setup.actionType,
          post2026: setup.post2026,
          thresholds: setup.thresholds,
          consortiumPartners: setup.partners.split(',').map(s => s.trim()).filter(Boolean),
          sshRequired: setup.sshRequired,
          aiRequired: setup.aiRequired,
          dnshRequired: setup.dnshRequired,
          callTopic: isTopicLoaded(callTopic) ? callTopic : undefined,
        }),
      })
      if (res.status === 410) {
        setCacheMiss(true)
        return
      }
      const data = await res.json()
      setResults(prev => ({ ...prev, [criterion]: data }))
    } catch (e) {
      console.error('Generation failed:', e)
    } finally {
      setGenerating(null)
    }
  }

  async function generateAll() {
    for (const c of criteriaIds) {
      await generateCriterion(c)
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  async function exportDocx() {
    setExporting(true)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'esr_docx',
          proposalRef: setup.proposalRef,
          actionType: setup.actionType,
          post2026: setup.post2026,
          thresholds: setup.thresholds,
          criteria: Object.values(results).map(r => ({
            ...r,
            comment: r.comment.replace(/\n\n\[Outcomes addressed[^\]]*\]$/s, '').trim(),
          })),
          evaluatorIdentity: 'IRIS Self-Assessment',
          callTopic: isTopicLoaded(callTopic) ? callTopic : undefined,
        }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${setup.proposalRef}_evaluation.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExporting(false)
    }
  }

  // ── Threshold helpers ─────────────────────────────────────────────────────────

  const totalScore = criteriaIds.reduce((s, c) => s + (results[c]?.score ?? 0), 0)
  const allPassIndividual = criteriaIds.every(c => !results[c] || results[c].score >= setup.thresholds.individual)
  const passesTotal = totalScore >= setup.thresholds.total
  const anyFlags = criteriaIds.some(c => results[c]?.flags?.length > 0)

  // ── Compliance for export step ────────────────────────────────────────────────

  const topicLoaded = isTopicLoaded(callTopic)
  const cond = callTopic.specificConditions
  const trlRequired = cond.trlAtStart !== null || cond.trlAtEnd !== null
  const proposalMentionsTrl = trlRequired
    ? /\bTRL\s*[0-9]/i.test(setup.proposalText)
    : true
  const topicFlagsOk = (!cond.requiresSSH || setup.sshRequired)
    && (!cond.requiresAIRobustness || setup.aiRequired)
    && (!cond.requiresDNSH || setup.dnshRequired)

  const complianceChecks: Array<{ id: string; label: string; pass: boolean; advisory?: boolean }> = [
    { id: 'generated', label: 'All criteria generated', pass: completedCount === criteriaIds.length },
    { id: 'individual', label: 'All criteria pass individual threshold', pass: allPassIndividual && completedCount > 0 },
    { id: 'total', label: `Total score passes total threshold (${setup.thresholds.total})`, pass: passesTotal && completedCount > 0 },
    { id: 'flags', label: 'No quality-guard flags in any criterion', pass: !anyFlags },
    { id: 'ref', label: 'Proposal reference set', pass: !!setup.proposalRef.trim() },
    ...(topicLoaded
      ? [
          { id: 'topic_loaded', label: `Call topic loaded (${callTopic.topicId || callTopic.topicTitle})`, pass: true, advisory: true },
          { id: 'outcomes_eval', label: 'Evaluation ran with call-topic context (outcome anchors populated)', pass: completedCount === criteriaIds.length, advisory: true },
          { id: 'trl_check', label: trlRequired ? 'Proposal text references TRL level' : 'No TRL target specified in call', pass: proposalMentionsTrl, advisory: true },
          { id: 'topic_flags', label: 'Required topic elements (SSH/AI/DNSH) enabled in setup', pass: topicFlagsOk, advisory: true },
        ]
      : [{ id: 'topic_optional', label: 'No call topic loaded (optional — add in Setup for richer evaluation)', pass: false, advisory: true }]
    ),
  ]

  const hasBlockingFailure = complianceChecks.some(c => !c.pass && !c.advisory)

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar role="manager" />
      <div style={{ flex: 1, marginLeft: 220, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 32px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Scale size={22} color={C.cyan} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>Proposal Evaluator</h1>
            {setup.proposalRef && (
              <span style={{ fontSize: 13, color: C.muted, marginLeft: 8 }}>{setup.proposalRef}</span>
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
                Paste your proposal text and configure the evaluation parameters. The evaluator will score each criterion against Horizon Europe standards.
              </p>

              {/* Proposal text — upload or paste */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Proposal text * — upload a file or paste below</label>

                {/* Upload zone */}
                <label
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    padding: '14px 20px', marginBottom: 10,
                    border: `2px dashed ${uploadInfo ? C.green : C.border}`,
                    borderRadius: 9, cursor: uploading ? 'default' : 'pointer',
                    background: uploadInfo ? 'rgba(22,163,74,0.05)' : C.input,
                    color: uploadInfo ? C.green : C.muted,
                    fontSize: 13, transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    style={{ display: 'none' }}
                    disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
                  />
                  {uploading
                    ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Extracting text…</>
                    : uploadInfo
                    ? <><Check size={16} /> {uploadInfo.wordCount.toLocaleString()} words extracted — click to replace</>
                    : <><Upload size={16} /> Upload PDF or DOCX</>}
                </label>

                {uploadError && (
                  <p style={{ fontSize: 12, color: C.red, margin: '0 0 8px' }}>{uploadError}</p>
                )}
                {uploadInfo && uploadInfo.sectionsFound.length > 0 && (
                  <p style={{ fontSize: 11, color: C.muted, margin: '0 0 4px' }}>
                    Sections detected: {uploadInfo.sectionsFound.slice(0, 5).join(' · ')}
                    {uploadInfo.sectionsFound.length > 5 ? ` + ${uploadInfo.sectionsFound.length - 5} more` : ''}
                  </p>
                )}
                {uploadInfo && (uploadInfo.tableCount > 0 || uploadInfo.figureCount > 0) && (
                  <p style={{ fontSize: 11, color: C.cyan, margin: '0 0 8px' }}>
                    {uploadInfo.tableCount} structured table{uploadInfo.tableCount !== 1 ? 's' : ''} · {uploadInfo.figureCount} figure page{uploadInfo.figureCount !== 1 ? 's' : ''} detected
                  </p>
                )}

                <textarea
                  value={setup.proposalText}
                  onChange={e => setSetup(p => ({ ...p, proposalText: e.target.value }))}
                  rows={uploadInfo ? 6 : 12}
                  placeholder="…or paste the full proposal text (Part B) here"
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                {setup.proposalText.length > 0 && (
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {setup.proposalText.length.toLocaleString()} characters
                    {setup.proposalText.length > 20000 ? ' — will be capped to 20,000 for evaluation' : ''}
                  </span>
                )}
              </div>

              {/* Proposal ref + action type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Proposal reference *</label>
                  <input
                    value={setup.proposalRef}
                    onChange={e => setSetup(p => ({ ...p, proposalRef: e.target.value }))}
                    placeholder="e.g. PHOTOSENSE or filename"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Action type</label>
                  <select
                    value={setup.actionType}
                    onChange={e => setSetup(p => ({ ...p, actionType: e.target.value as ActionType }))}
                    style={inputStyle}
                  >
                    <option value="RIA">RIA — Research and Innovation</option>
                    <option value="IA">IA — Innovation Action</option>
                    <option value="CSA">CSA — Coordination and Support</option>
                    <option value="CoFund">CoFund — Co-fund</option>
                    <option value="PCP">PCP — Pre-commercial Procurement</option>
                    <option value="PPI">PPI — Public Procurement of Innovation</option>
                    <option value="ERC">ERC — European Research Council</option>
                  </select>
                </div>
              </div>

              {/* Work programme year + partners */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Work programme year</label>
                  <select
                    value={setup.post2026 ? 'post2026' : 'pre2026'}
                    onChange={e => setSetup(p => ({ ...p, post2026: e.target.value === 'post2026' }))}
                    style={inputStyle}
                  >
                    <option value="pre2026">Pre-2026</option>
                    <option value="post2026">2026 and later</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Consortium partners (comma-separated)</label>
                  <input
                    value={setup.partners}
                    onChange={e => setSetup(p => ({ ...p, partners: e.target.value }))}
                    placeholder="e.g. IRIS, KU Leuven, TU Berlin"
                    style={inputStyle}
                  />
                  {!setup.partners.trim() && (
                    <span style={{ fontSize: 11, color: C.amber, display: 'block', marginTop: 4 }}>
                      No partners set — fabricated organisation names will not be flagged
                    </span>
                  )}
                </div>
              </div>

              {/* Thresholds */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>Individual threshold</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={setup.thresholds.individual}
                    onChange={e => setSetup(p => ({ ...p, thresholds: { ...p.thresholds, individual: parseFloat(e.target.value) || 0 } }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Total threshold</label>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={setup.thresholds.total}
                    onChange={e => setSetup(p => ({ ...p, thresholds: { ...p.thresholds, total: parseFloat(e.target.value) || 0 } }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    Criteria: {getCriteria(setup.actionType).join(', ')}
                  </span>
                </div>
              </div>

              {/* Call Topic panel */}
              <div style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setTopicPanelOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '10px 14px',
                    background: topicLoaded ? 'rgba(74,158,255,0.08)' : C.panel,
                    border: `1px solid ${topicLoaded ? C.cyan : C.border}`,
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    color: topicLoaded ? C.cyan : C.muted,
                  }}>
                  <ChevronDown size={14} style={{ transform: topicPanelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  Call / Topic Context
                  {topicLoaded
                    ? <span style={{ marginLeft: 'auto', fontWeight: 400, color: C.text, fontSize: 12 }}>{callTopic.topicId || callTopic.topicTitle}</span>
                    : <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 12 }}>optional — improves evaluation relevance</span>}
                </button>

                {topicPanelOpen && (
                  <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '18px 16px', background: C.panel }}>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                      <div>
                        <label style={labelStyle}>Topic ID (e.g. HORIZON-CL4-2026-TWIN-01-01)</label>
                        <input
                          value={callTopic.topicId}
                          onChange={e => setCallTopic(p => ({ ...p, topicId: e.target.value }))}
                          placeholder="HORIZON-CL4-…"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Topic title</label>
                        <input
                          value={callTopic.topicTitle}
                          onChange={e => setCallTopic(p => ({ ...p, topicTitle: e.target.value }))}
                          placeholder="e.g. Advanced NIR sensing for…"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                      <div>
                        <label style={labelStyle}>Destination / Programme</label>
                        <input
                          value={callTopic.destination}
                          onChange={e => setCallTopic(p => ({ ...p, destination: e.target.value }))}
                          placeholder="e.g. Horizon Europe Cluster 4"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Cluster</label>
                        <input
                          value={callTopic.cluster}
                          onChange={e => setCallTopic(p => ({ ...p, cluster: e.target.value }))}
                          placeholder="e.g. Digital, Industry & Space"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Partnership / Mission</label>
                        <input
                          value={callTopic.partnership}
                          onChange={e => setCallTopic(p => ({ ...p, partnership: e.target.value }))}
                          placeholder="e.g. KDT JU"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>Expected outcomes — one per line (paste from call text)</label>
                      <textarea
                        value={callTopic.expectedOutcomes.join('\n')}
                        onChange={e => setCallTopic(p => ({ ...p, expectedOutcomes: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) }))}
                        rows={4}
                        placeholder={'Researchers and innovators have access to…\nIndustry can deploy…\nPolicymakers can rely on…'}
                        style={{ ...inputStyle, resize: 'vertical' }}
                      />
                      <span style={{ fontSize: 11, color: C.muted }}>{callTopic.expectedOutcomes.length} outcome{callTopic.expectedOutcomes.length !== 1 ? 's' : ''} loaded</span>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>Scope (paste from call text)</label>
                      <textarea
                        value={callTopic.scope}
                        onChange={e => setCallTopic(p => ({ ...p, scope: e.target.value }))}
                        rows={4}
                        placeholder="The call supports projects that…"
                        style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    </div>

                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px', fontWeight: 600 }}>Specific conditions</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[
                            ['requiresSSH', 'SSH integration required'],
                            ['requiresAIRobustness', 'AI robustness assessment required'],
                            ['requiresDNSH', 'DNSH assessment required'],
                            ['civilApplicationsOnly', 'Civil applications only'],
                            ['openScienceMandatory', 'Open science mandatory'],
                          ].map(([key, label]) => (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={!!callTopic.specificConditions[key as keyof typeof callTopic.specificConditions]}
                                onChange={e => updateTopicConditions({ [key]: e.target.checked })}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <label style={labelStyle}>TRL at start</label>
                              <input
                                type="number" min={1} max={9} step={1}
                                value={callTopic.specificConditions.trlAtStart ?? ''}
                                onChange={e => updateTopicConditions({ trlAtStart: e.target.value ? parseInt(e.target.value) : null })}
                                placeholder="e.g. 3"
                                style={inputStyle}
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>TRL at end</label>
                              <input
                                type="number" min={1} max={9} step={1}
                                value={callTopic.specificConditions.trlAtEnd ?? ''}
                                onChange={e => updateTopicConditions({ trlAtEnd: e.target.value ? parseInt(e.target.value) : null })}
                                placeholder="e.g. 6"
                                style={inputStyle}
                              />
                            </div>
                          </div>
                          <div>
                            <label style={labelStyle}>Duration (months)</label>
                            <input
                              type="number" min={1} max={72} step={1}
                              value={callTopic.specificConditions.durationMonths ?? ''}
                              onChange={e => updateTopicConditions({ durationMonths: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder="e.g. 48"
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Indicative budget</label>
                            <input
                              value={callTopic.specificConditions.indicativeBudget}
                              onChange={e => updateTopicConditions({ indicativeBudget: e.target.value })}
                              placeholder="e.g. €3–5M"
                              style={inputStyle}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {topicLoaded && (
                      <button
                        type="button"
                        onClick={() => setCallTopic(emptyCallTopic())}
                        style={{
                          marginTop: 12, fontSize: 12, color: C.red, background: 'none',
                          border: 'none', cursor: 'pointer', padding: 0,
                        }}>
                        Clear topic
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: C.text }}>
                  <input
                    type="checkbox"
                    checked={setup.sshRequired}
                    onChange={e => setSetup(p => ({ ...p, sshRequired: e.target.checked }))}
                  />
                  SSH integration required
                </label>
                {setup.post2026 && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: C.text }}>
                      <input
                        type="checkbox"
                        checked={setup.aiRequired}
                        onChange={e => setSetup(p => ({ ...p, aiRequired: e.target.checked }))}
                      />
                      AI robustness assessment required
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: C.text }}>
                      <input
                        type="checkbox"
                        checked={setup.dnshRequired}
                        onChange={e => setSetup(p => ({ ...p, dnshRequired: e.target.checked }))}
                      />
                      DNSH assessment required
                    </label>
                  </>
                )}
              </div>

              <button
                onClick={() => setStep('evaluate')}
                disabled={!canProceed}
                style={{
                  padding: '10px 28px',
                  background: canProceed ? C.cyan : C.border,
                  color: canProceed ? '#0B1220' : C.muted,
                  border: 'none', borderRadius: 8,
                  cursor: canProceed ? 'pointer' : 'not-allowed',
                  fontWeight: 700, fontSize: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                Continue to Evaluate <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* ── EVALUATE ── */}
          {step === 'evaluate' && (
            <div style={{ maxWidth: 800 }}>

              {/* Cache-miss banner */}
              {cacheMiss && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', marginBottom: 16,
                  background: 'rgba(220,38,38,0.08)', border: `1px solid ${C.red}`,
                  borderRadius: 8, color: C.red, fontSize: 13,
                }}>
                  <AlertTriangle size={15} />
                  <span>Session expired — please re-upload your proposal to continue.</span>
                  <button onClick={() => { setCacheMiss(false); setStep('setup') }}
                    style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${C.red}`, borderRadius: 6, color: C.red, cursor: 'pointer', padding: '3px 10px', fontSize: 12 }}>
                    Re-upload
                  </button>
                </div>
              )}

              {/* Generate all + summary */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <button
                  onClick={generateAll}
                  disabled={!!generating}
                  style={{
                    padding: '9px 18px', background: C.cyan, color: '#0B1220',
                    border: 'none', borderRadius: 8, cursor: generating ? 'not-allowed' : 'pointer',
                    fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                    opacity: generating ? 0.6 : 1,
                  }}>
                  {generating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Scale size={14} />}
                  Generate All
                </button>

                <div style={{ fontSize: 13, color: C.muted }}>
                  {completedCount}/{criteriaIds.length} criteria generated
                  {completedCount > 0 && (
                    <span style={{ marginLeft: 12, fontWeight: 600, color: passesTotal && allPassIndividual ? C.green : C.red }}>
                      Total: {totalScore.toFixed(1)} / {criteriaIds.length * 5}
                    </span>
                  )}
                </div>
              </div>

              {/* Criterion panels */}
              {criteriaIds.map(criterion => {
                const result = results[criterion]
                const isGenerating = generating === criterion
                const label = CRITERION_DISPLAY[criterion]
                const passes = result ? result.score >= setup.thresholds.individual : null

                return (
                  <div key={criterion} style={{
                    background: C.panel, border: `1px solid ${C.border}`,
                    borderRadius: 10, padding: '20px 24px', marginBottom: 20,
                  }}>
                    {/* Panel header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{label}</h2>
                        {result && (
                          <>
                            <span style={{
                              padding: '2px 10px', borderRadius: 20, fontSize: 13, fontWeight: 700,
                              background: passes ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                              color: passes ? C.green : C.red,
                            }}>
                              {result.score} / 5
                            </span>
                            {passes !== null && (
                              <span style={{ fontSize: 12, color: passes ? C.green : C.red }}>
                                {passes ? '✓ Passes' : `✗ Below ${setup.thresholds.individual}`}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {result && (
                          <button
                            onClick={() => generateCriterion(criterion)}
                            disabled={!!generating}
                            style={{
                              padding: '6px 12px', background: 'transparent', border: `1px solid ${C.border}`,
                              borderRadius: 6, color: C.muted, cursor: generating ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                            }}>
                            <RefreshCw size={13} /> Regenerate
                          </button>
                        )}
                        {!result && !isGenerating && (
                          <button
                            onClick={() => generateCriterion(criterion)}
                            disabled={!!generating}
                            style={{
                              padding: '6px 16px', background: C.cyan, color: '#0B1220',
                              border: 'none', borderRadius: 6, cursor: generating ? 'not-allowed' : 'pointer',
                              fontWeight: 600, fontSize: 13, opacity: generating ? 0.6 : 1,
                            }}>
                            Generate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Loading */}
                    {isGenerating && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.muted, fontSize: 14, padding: '12px 0' }}>
                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                        Generating {label} evaluation…
                      </div>
                    )}

                    {/* Result */}
                    {result && !isGenerating && (
                      <>
                        {/* Quality-guard flags */}
                        {result.flags && result.flags.length > 0 && (
                          <div style={{
                            background: 'rgba(217,119,6,0.08)', border: `1px solid rgba(217,119,6,0.3)`,
                            borderRadius: 6, padding: '10px 14px', marginBottom: 14,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <AlertTriangle size={14} color={C.amber} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.amber }}>Quality guard flags</span>
                            </div>
                            {result.flags.map((f, i) => (
                              <div key={i} style={{ fontSize: 12, color: C.amber }}>• {f}</div>
                            ))}
                          </div>
                        )}

                        {/* Comment */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={labelStyle}>Evaluator comment (editable)</label>
                          <textarea
                            value={result.comment}
                            onChange={e => setResults(prev => ({
                              ...prev,
                              [criterion]: { ...prev[criterion], comment: e.target.value },
                            }))}
                            rows={6}
                            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7 }}
                          />
                        </div>

                        {/* Aspects summary */}
                        {result.aspects && result.aspects.length > 0 && (
                          <details style={{ fontSize: 13 }}>
                            <summary style={{ cursor: 'pointer', color: C.muted, marginBottom: 8 }}>
                              Aspect details ({result.aspects.length})
                            </summary>
                            {result.aspects.map((asp, i) => (
                              <div key={i} style={{
                                background: C.white, border: `1px solid ${C.border}`,
                                borderRadius: 6, padding: '10px 14px', marginBottom: 8,
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, color: C.text }}>{asp.aspectId}</span>
                                  {asp.aspectScore !== undefined && (
                                    <span style={{
                                      padding: '1px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                                      background: asp.aspectScore >= 4 ? 'rgba(22,163,74,0.1)' : asp.aspectScore <= 2.5 ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.1)',
                                      color: asp.aspectScore >= 4 ? C.green : asp.aspectScore <= 2.5 ? C.red : C.amber,
                                    }}>
                                      {asp.aspectScore.toFixed(1)} / 5
                                    </span>
                                  )}
                                  {asp.scoreSource && (
                                    <span style={{
                                      padding: '1px 7px', borderRadius: 12, fontSize: 11,
                                      background: asp.scoreSource === 'computed' ? 'rgba(74,158,255,0.12)' : 'rgba(90,106,154,0.12)',
                                      color: asp.scoreSource === 'computed' ? C.cyan : C.muted,
                                      fontWeight: 600,
                                    }}>
                                      {asp.scoreSource === 'computed' ? 'computed' : asp.scoreSource === 'comparative-ensemble' ? 'comparative' : 'judgement'}
                                    </span>
                                  )}
                                  {asp.topicAnchor && (
                                    <span style={{ fontSize: 11, color: C.cyan }}>{asp.topicAnchor}</span>
                                  )}
                                </div>
                                {asp.scoreJustification && (
                                  <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 6 }}>{asp.scoreJustification}</div>
                                )}
                                {asp.evidenceDensitySignals && asp.evidenceDensitySignals.length > 0 && (
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: C.cyan, marginBottom: 4 }}>Evidence-density signals</div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                      <thead>
                                        <tr style={{ color: C.muted }}>
                                          <th style={{ textAlign: 'left', paddingBottom: 3, fontWeight: 600 }}>Signal</th>
                                          <th style={{ textAlign: 'right', paddingBottom: 3, fontWeight: 600 }}>Count</th>
                                          <th style={{ textAlign: 'right', paddingBottom: 3, fontWeight: 600 }}>Cap</th>
                                          <th style={{ textAlign: 'right', paddingBottom: 3, fontWeight: 600 }}>Weight</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {asp.evidenceDensitySignals.map((sig, si) => (
                                          <tr key={si} style={{ borderTop: `1px solid ${C.border}` }}>
                                            <td style={{ paddingTop: 3, color: C.text }}>{sig.name}</td>
                                            <td style={{ textAlign: 'right', paddingTop: 3, color: sig.count >= sig.cappedAt ? C.green : sig.count === 0 ? C.red : C.amber, fontWeight: 600 }}>{sig.count}</td>
                                            <td style={{ textAlign: 'right', paddingTop: 3, color: C.muted }}>{sig.cappedAt}</td>
                                            <td style={{ textAlign: 'right', paddingTop: 3, color: C.muted }}>{sig.weight}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {asp.strengths && asp.strengths.length > 0 && (
                                  <div style={{ marginBottom: 4 }}>
                                    {asp.strengths.map((s, j) => (
                                      <div key={j} style={{ color: C.green, fontSize: 12 }}>✓ {s}</div>
                                    ))}
                                  </div>
                                )}
                                {asp.shortcomings && asp.shortcomings.length > 0 && (
                                  <div>
                                    {asp.shortcomings.map((sc, j) => (
                                      <div key={j} style={{ color: C.amber, fontSize: 12 }}>
                                        [{sc.severity}] {sc.text}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )
              })}

              {/* Overall score summary */}
              {completedCount > 0 && (
                <div style={{
                  background: C.panel, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: '16px 24px',
                  display: 'flex', alignItems: 'center', gap: 24,
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>Total Score</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>
                      {totalScore.toFixed(1)} / {criteriaIds.length * 5}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>Overall result</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: passesTotal && allPassIndividual ? C.green : C.red }}>
                      {passesTotal && allPassIndividual ? '✓ Passes all thresholds' : '✗ Does not pass all thresholds'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── EXPORT ── */}
          {step === 'export' && (
            <div style={{ maxWidth: 640 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Export Evaluation Report</h2>
              <p style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>
                {completedCount} of {criteriaIds.length} criteria evaluated. Review the checks below before downloading.
              </p>

              {/* Compliance card */}
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 28 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 14px' }}>Pre-export Compliance</p>
                {complianceChecks.map(chk => {
                  const iconColor = chk.pass ? C.green : (chk.advisory ? C.amber : C.red)
                  const textColor = chk.pass ? C.text : (chk.advisory ? C.amber : C.red)
                  return (
                    <div key={chk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {chk.pass
                          ? <Check size={14} color={iconColor} />
                          : chk.advisory
                          ? <AlertTriangle size={14} color={iconColor} />
                          : <X size={14} color={iconColor} />}
                      </span>
                      <span style={{ fontSize: 13, color: textColor }}>
                        {chk.label}
                        {chk.advisory && !chk.pass && <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>(advisory)</span>}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Per-criterion summary */}
              {criteriaIds.map(c => {
                const result = results[c]
                return (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                    {result
                      ? <Check size={16} color={result.score >= setup.thresholds.individual ? C.green : C.red} />
                      : <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}` }} />}
                    <span style={{ flex: 1, fontSize: 14, color: result ? C.text : C.muted }}>
                      {CRITERION_DISPLAY[c as CriterionId]}
                    </span>
                    {result && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: result.score >= setup.thresholds.individual ? C.green : C.red }}>
                        {result.score} / 5
                      </span>
                    )}
                  </div>
                )
              })}

              <button
                onClick={exportDocx}
                disabled={exporting || completedCount === 0}
                style={{
                  marginTop: 28, padding: '12px 28px', background: C.cyan, color: '#0B1220',
                  border: 'none', borderRadius: 8,
                  cursor: exporting || completedCount === 0 ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10,
                  opacity: completedCount === 0 ? 0.5 : 1,
                }}>
                {exporting ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={18} />}
                Download DOCX
              </button>

              {hasBlockingFailure && completedCount > 0 && (
                <p style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>
                  Some compliance checks are failing — review before distributing the report.
                </p>
              )}

              {/* Disclaimer */}
              <p style={{ fontSize: 12, color: C.muted, marginTop: 20, lineHeight: 1.6 }}>
                This is an internal IRIS self-assessment tool modelled on Horizon Europe criteria. It is not an EC evaluation and carries no formal status.
              </p>
            </div>
          )}
        </div>

        {/* Footer nav */}
        {step !== 'setup' && (
          <div style={{ padding: '16px 32px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}
              style={{
                padding: '8px 20px', background: 'transparent', border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.muted, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 14,
              }}>
              <ChevronLeft size={16} /> Back
            </button>
            {step !== 'export' && (
              <button
                onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}
                style={{
                  padding: '8px 20px', background: C.cyan, color: '#0B1220',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                {step === 'evaluate' ? 'Export' : 'Next'} <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
