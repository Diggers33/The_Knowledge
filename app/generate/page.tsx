'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { FileOutput, FileText, Presentation, Loader2, Download, Sparkles } from 'lucide-react'

const OUTPUT_TYPES = [
  { id: 'pptx', label: 'PowerPoint', icon: Presentation, desc: 'Formatted slide deck with IRIS branding' },
  { id: 'docx', label: 'Word Document', icon: FileText, desc: 'Structured technical report or review' },
]

const EXAMPLES = [
  { type: 'pptx', prompt: 'Summarise all pharma projects IRIS has worked on' },
  { type: 'docx', prompt: 'Write a state of the art review on NIR spectroscopy for food quality control' },
  { type: 'pptx', prompt: 'Overview of all Horizon Europe projects and their outcomes' },
  { type: 'docx', prompt: 'Technical summary of all calibration transfer methods used by IRIS' },
  { type: 'pptx', prompt: 'IRIS capabilities in hyperspectral imaging for industrial applications' },
  { type: 'docx', prompt: 'Review of inline NIR applications developed across IRIS projects' },
]

const BG      = '#080C20'
const SURFACE = '#0D1235'
const SURFACE_MID = '#121847'
const BORDER  = '#1E2B6A'
const TEXT    = '#E8EEFF'
const MUTED   = '#8A96C4'
const DIM     = '#4A5590'
const ACCENT  = '#4A9EFF'

export default function GeneratePage() {
  const [outputType, setOutputType] = useState('pptx')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function generate() {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError('')
    setDone(false)
    setStatus('Searching knowledge base…')

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, outputType })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      setStatus('Building document…')
      const blob = await res.blob()
      const ext = outputType === 'pptx' ? 'pptx' : 'docx'
      const fname = `IRIS_${prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname; a.click()
      URL.revokeObjectURL(url)
      setStatus('')
      setDone(true)
    } catch (e: any) {
      setError(e.message || 'Generation failed')
      setStatus('')
    }
    setLoading(false)
  }

  const canGenerate = !!prompt.trim() && !loading

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG }}>
      <Sidebar role="manager" />
      <main style={{ marginLeft: '220px', flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: '660px', margin: '0 auto', padding: '32px 24px 60px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={18} color={ACCENT} />
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: TEXT, margin: 0 }}>Document Generator</h1>
              <p style={{ fontSize: '12px', color: MUTED, margin: '3px 0 0' }}>Generate formatted documents from the IRIS knowledge base</p>
            </div>
          </div>

          {/* Format picker */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '12px', padding: '18px', marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: DIM, marginBottom: '12px' }}>
              Output Format
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {OUTPUT_TYPES.map(({ id, label, icon: Icon, desc }) => {
                const active = outputType === id
                return (
                  <button key={id} onClick={() => setOutputType(id)} style={{
                    padding: '14px 16px', borderRadius: '9px', cursor: 'pointer', textAlign: 'left',
                    background: active ? 'rgba(34,211,238,0.08)' : SURFACE_MID,
                    border: `1px solid ${active ? ACCENT + '60' : BORDER}`,
                    transition: 'all 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: active ? ACCENT : TEXT, marginBottom: '4px' }}>
                      <Icon size={14} />
                      {label}
                    </div>
                    <div style={{ fontSize: '11px', color: MUTED }}>{desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Prompt */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '12px', padding: '18px', marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: DIM, marginBottom: '10px' }}>
              What do you want to generate?
            </div>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setDone(false) }}
              rows={4}
              placeholder="e.g. Summarise all pharma projects IRIS has worked on, including methods used and key outcomes"
              style={{
                width: '100%', background: SURFACE_MID, border: `1px solid ${BORDER}`,
                borderRadius: '9px', padding: '12px 14px', fontSize: '14px',
                fontFamily: 'inherit', color: TEXT, resize: 'none', outline: 'none',
                lineHeight: 1.6, boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Generate button */}
          <button onClick={generate} disabled={!canGenerate} style={{
            width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
            background: canGenerate ? ACCENT : SURFACE_MID,
            color: canGenerate ? '#0B1220' : DIM,
            fontSize: '14px', fontWeight: 700, fontFamily: 'inherit',
            cursor: canGenerate ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            transition: 'all 0.15s',
            boxShadow: canGenerate ? '0 0 20px rgba(34,211,238,0.2)' : 'none',
          }}>
            {loading
              ? <><Loader2 size={16} className="spin" /> {status || 'Generating…'}</>
              : done
              ? <><span>✓</span> Downloaded — generate again?</>
              : <><Download size={16} /> Generate &amp; Download</>
            }
          </button>

          {error && (
            <div style={{ margin: '12px 0', padding: '12px 16px', borderRadius: '9px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', color: '#F87171', fontSize: '13px' }}>
              {error}
            </div>
          )}
          {done && (
            <div style={{ margin: '12px 0', padding: '12px 16px', borderRadius: '9px', background: 'rgba(45,203,122,0.07)', border: '1px solid rgba(45,203,122,0.2)', color: '#2DCB7A', fontSize: '13px' }}>
              ✓ Your document has been downloaded.
            </div>
          )}

          {/* Examples */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '12px', padding: '18px', marginTop: '22px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: DIM, marginBottom: '12px' }}>
              Example Prompts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {EXAMPLES.map((ex, i) => (
                <button key={i}
                  onClick={() => { setPrompt(ex.prompt); setOutputType(ex.type); setDone(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                    background: 'transparent', border: `1px solid ${BORDER}`,
                    transition: 'all 0.12s', textAlign: 'left',
                  }}>
                  {/* Type icon instead of cyan badge */}
                  <span style={{ flexShrink: 0 }}>
                    {ex.type === 'pptx'
                      ? <Presentation size={14} color={ACCENT} />
                      : <FileText size={14} color="#2DCB7A" />}
                  </span>
                  <span style={{ fontSize: '13px', color: MUTED }}>{ex.prompt}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
