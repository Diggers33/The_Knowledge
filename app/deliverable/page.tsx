'use client'
import { useState, useRef, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { Loader2, Download, ChevronRight, ChevronLeft, FileText, Check, RefreshCw } from 'lucide-react'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Step = 'setup' | 'write' | 'export'

interface DeliverableSetup {
  projectCode: string
  wpNumber: string
  deliverableRef: string
  deliverableTitle: string
  additionalContext: string
}

interface SectionConfig {
  id: string
  label: string
  description: string
  wordTarget: number
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const C = {
  bg:     '#0B1220',
  panel:  '#111A2B',
  input:  '#162235',
  border: '#22304A',
  cyan:   '#22D3EE',
  text:   '#E6EDF7',
  muted:  '#8A9AB3',
  green:  '#2DCB7A',
  amber:  '#F59E0B',
  red:    '#F87171',
}

const SECTIONS: SectionConfig[] = [
  { id: 'executive_summary',  label: 'Executive Summary',      description: 'Objective, scope, key results, and status against plan',       wordTarget: 300 },
  { id: 'methodology',        label: 'Methodology',             description: 'Experimental setup, instruments, protocols, and approach',      wordTarget: 500 },
  { id: 'technical_results',  label: 'Technical Results',       description: 'Specific outcomes, measurements, accuracy figures, TRL status', wordTarget: 600 },
  { id: 'iris_contribution',  label: 'IRIS Contribution',       description: 'What IRIS specifically developed, built, and achieved',         wordTarget: 400 },
  { id: 'validation',         label: 'Validation & KPIs',       description: 'KPI targets vs results, pilot tests, performance benchmarks',   wordTarget: 500 },
  { id: 'conclusions',        label: 'Conclusions & Next Steps',description: 'Key findings, challenges, lessons learned, and next steps',     wordTarget: 400 },
]

const STEPS: Step[] = ['setup', 'write', 'export']
const STEP_LABELS: Record<Step, string> = { setup: 'Setup', write: 'Write', export: 'Export' }

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DeliverablePage() {
  const [step, setStep] = useState<Step>('setup')
  const [setup, setSetup] = useState<DeliverableSetup>({
    projectCode: '',
    wpNumber: 'WP1',
    deliverableRef: 'D1.1',
    deliverableTitle: '',
    additionalContext: '',
  })
  const [sections, setSections] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('executive_summary')
  const [exporting, setExporting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
        }),
      })

      if (!res.ok) throw new Error(await res.text())
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setSections(prev => ({ ...prev, [sectionId]: text }))
      }
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
  }, [setup, sections])

  const completedCount = SECTIONS.filter(s => sections[s.id]?.trim()).length
  const canProceed = setup.projectCode.trim() && setup.deliverableTitle.trim()

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
              <button key={s} onClick={() => { if (s !== 'setup' || true) setStep(s) }}
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
            <div style={{ maxWidth: 680 }}>
              <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>
                Enter the deliverable details. The writer will pull context from the IRIS knowledge base automatically.
              </p>

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
                <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6 }}>
                  Additional Context (optional)
                </label>
                <textarea value={setup.additionalContext}
                  onChange={e => setSetup(p => ({ ...p, additionalContext: e.target.value }))}
                  rows={6}
                  placeholder="Paste WP description, task objectives, KPIs, or any specific results to include..."
                  style={{
                    width: '100%', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8,
                    color: C.text, fontSize: 14, padding: '10px 14px', resize: 'vertical', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }} />
              </div>

              <button onClick={() => setStep('write')} disabled={!canProceed}
                style={{
                  padding: '10px 28px', background: canProceed ? C.cyan : C.border,
                  color: canProceed ? '#0B1220' : C.muted, border: 'none', borderRadius: 8,
                  cursor: canProceed ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                Continue to Write <ChevronRight size={16} />
              </button>
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
            <div style={{ maxWidth: 560 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Export Deliverable</h2>
              <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>
                {completedCount} of {SECTIONS.length} sections generated. Download as a formatted DOCX document.
              </p>

              {SECTIONS.map(sec => (
                <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                  {sections[sec.id] ? <Check size={16} color={C.green} /> : <div style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}` }} />}
                  <span style={{ flex: 1, fontSize: 14, color: sections[sec.id] ? C.text : C.muted }}>{sec.label}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{wordCount(sections[sec.id] || '')} words</span>
                </div>
              ))}

              <button onClick={exportDocx} disabled={exporting || completedCount === 0}
                style={{
                  marginTop: 28, padding: '12px 28px', background: C.cyan, color: '#0B1220',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 15,
                  display: 'flex', alignItems: 'center', gap: 10, opacity: completedCount === 0 ? 0.5 : 1,
                }}>
                {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                Download DOCX
              </button>
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
  const C_local = { input: '#162235', border: '#22304A', text: '#E6EDF7', muted: '#8A9AB3' }
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: C_local.muted, marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', background: C_local.input, border: `1px solid ${C_local.border}`,
          borderRadius: 8, color: C_local.text, fontSize: 14, padding: '9px 12px', boxSizing: 'border-box',
        }} />
    </div>
  )
}
