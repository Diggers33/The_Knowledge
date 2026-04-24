'use client'
import { useState, useRef, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { Send, Bot, User, FileText, RefreshCw, Search, Zap, BarChart2, Layers } from 'lucide-react'

interface Source { file: string; page: number; similarity: number }
interface ConfidenceSignals {
  level: 'high' | 'medium' | 'low'
  signals: string[]
  topRerank: number
  hasStructuredFacts: boolean
  hasGraphFacts: boolean
  hasSummaries: boolean
}
interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  searchQuery?: string | null
  routedVia?: string
  confidence?: ConfidenceSignals
  graphUsed?: boolean
}

const SUGGESTIONS = [
  'What projects has IRIS worked on?',
  'What NIR methods has IRIS used for pharmaceutical raw material ID?',
  'Summarise IRIS involvement in Horizon Europe funded projects',
  'What inline NIR applications has IRIS developed for food processing?',
]

const BG          = '#0B1220'
const SURFACE     = '#111A2B'
const SURFACE_MID = '#162235'
const BORDER      = '#22304A'
const TEXT        = '#E6EDF7'
const MUTED       = '#8A9AB3'
const DIM         = '#4A5F7A'
const ACCENT      = '#22D3EE'
const GREEN       = '#2DCB7A'
const AMBER       = '#F59E0B'

// ─── INLINE MARKDOWN RENDERER ─────────────────────────────────────────────────
// Handles: headings, bold/italic, inline code, code blocks, tables, bullet/numbered lists

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0

  const inlineFormat = (s: string, key: string): React.ReactNode => {
    // Split on bold (**...**), italic (*...*), inline code (`...`)
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    return (
      <span key={key}>
        {parts.map((p, pi) => {
          if (p.startsWith('**') && p.endsWith('**')) return <strong key={pi}>{p.slice(2, -2)}</strong>
          if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={pi}>{p.slice(1, -1)}</em>
          if (p.startsWith('`') && p.endsWith('`')) return (
            <code key={pi} style={{ background: '#1C2D42', borderRadius: '3px', padding: '1px 5px', fontSize: '12px', fontFamily: 'monospace', color: ACCENT }}>{p.slice(1, -1)}</code>
          )
          return p
        })}
      </span>
    )
  }

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      nodes.push(
        <pre key={i} style={{ background: '#0D1926', border: `1px solid ${BORDER}`, borderRadius: '8px', padding: '12px 14px', overflowX: 'auto', fontSize: '12px', fontFamily: 'monospace', color: '#CBD5E1', margin: '10px 0' }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i++
      continue
    }

    // Table
    if (line.includes('|') && lines[i + 1]?.match(/^\s*\|[-| :]+\|\s*$/)) {
      const tableLines: string[] = [line]
      i += 2 // skip separator row
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim())
      const rows = tableLines.slice(1).map(r => r.split('|').filter(c => c.trim()).map(c => c.trim()))
      nodes.push(
        <div key={i} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
            <thead>
              <tr>{headers.map((h, hi) => (
                <th key={hi} style={{ borderBottom: `1px solid ${BORDER}`, padding: '6px 12px', textAlign: 'left', color: ACCENT, fontWeight: 600, background: SURFACE_MID }}>{inlineFormat(h, `th${hi}`)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '6px 12px', color: TEXT }}>{inlineFormat(cell, `td${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (hMatch) {
      const level = hMatch[1].length
      const sizes = ['17px', '15px', '14px']
      nodes.push(
        <div key={i} style={{ fontSize: sizes[level - 1] || '14px', fontWeight: 700, color: level === 1 ? ACCENT : TEXT, margin: `${level === 1 ? 16 : 12}px 0 4px`, lineHeight: 1.3 }}>
          {inlineFormat(hMatch[2], `h${i}`)}
        </div>
      )
      i++
      continue
    }

    // Bullet list block
    if (line.match(/^[-*]\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push(lines[i].slice(2))
        i++
      }
      nodes.push(
        <ul key={i} style={{ margin: '6px 0', paddingLeft: '18px', listStyle: 'none' }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ color: TEXT, fontSize: '13.5px', lineHeight: 1.65, marginBottom: '3px', display: 'flex', gap: '8px' }}>
              <span style={{ color: ACCENT, flexShrink: 0, marginTop: '2px' }}>·</span>
              <span>{inlineFormat(item, `li${ii}`)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Numbered list block
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = []
      let num = 1
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      nodes.push(
        <ol key={i} style={{ margin: '6px 0', paddingLeft: '18px', listStyle: 'none', counterReset: 'item' }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ color: TEXT, fontSize: '13.5px', lineHeight: 1.65, marginBottom: '3px', display: 'flex', gap: '8px' }}>
              <span style={{ color: ACCENT, flexShrink: 0, minWidth: '16px', marginTop: '2px' }}>{ii + 1}.</span>
              <span>{inlineFormat(item, `ol${ii}`)}</span>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Blank line
    if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: '6px' }} />)
      i++
      continue
    }

    // Paragraph
    nodes.push(
      <p key={i} style={{ margin: '3px 0', lineHeight: 1.7, color: TEXT, fontSize: '13.5px' }}>
        {inlineFormat(line, `p${i}`)}
      </p>
    )
    i++
  }

  return nodes
}

// ─── CONFIDENCE BADGE ─────────────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, { label: string; color: string }> = {
  numerical:  { label: 'Numerical',  color: '#A78BFA' },
  synthesis:  { label: 'Synthesis',  color: '#34D399' },
  broad:      { label: 'Broad',      color: ACCENT },
  specific:   { label: 'Specific',   color: '#60A5FA' },
  table:      { label: 'Table',      color: '#F97316' },
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   GREEN,
  medium: AMBER,
  low:    '#EF4444',
}

function ConfidenceBadge({ confidence, routedVia }: { confidence: ConfidenceSignals; routedVia?: string }) {
  const [open, setOpen] = useState(false)
  const route = routedVia ? ROUTE_LABELS[routedVia] : null
  const color = CONFIDENCE_COLORS[confidence.level]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
      {route && (
        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(34,211,238,0.08)', border: `1px solid ${BORDER}`, color: route.color, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Layers size={9} />
          {route.label}
        </span>
      )}
      <button onClick={() => setOpen(!open)} title="Confidence details"
        style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: 'transparent', border: `1px solid ${BORDER}`, color, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <BarChart2 size={9} color={color} />
        {confidence.level.charAt(0).toUpperCase() + confidence.level.slice(1)} confidence
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: '24px', left: 0, zIndex: 10, background: SURFACE_MID, border: `1px solid ${BORDER}`, borderRadius: '8px', padding: '10px 12px', minWidth: '220px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: '10px', color: MUTED, marginBottom: '6px', fontWeight: 600 }}>ANSWER SIGNALS</div>
          {confidence.signals.map((s, i) => (
            <div key={i} style={{ fontSize: '11px', color: TEXT, display: 'flex', gap: '6px', marginBottom: '4px' }}>
              <span style={{ color: GREEN }}>✓</span>{s}
            </div>
          ))}
          {confidence.topRerank > 0 && (
            <div style={{ fontSize: '10px', color: DIM, marginTop: '6px' }}>
              Best source match: {(confidence.topRerank * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content, history: messages })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages([...newHistory, {
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
        searchQuery: data.searchQuery,
        routedVia: data.routedVia,
        confidence: data.confidence,
        graphUsed: data.graphUsed,
      }])
    } catch (e: any) {
      setMessages([...newHistory, { role: 'assistant', content: `Error: ${e.message}` }])
    }
    setLoading(false)
  }

  const canSend = !!input.trim() && !loading

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG }}>
      <Sidebar role="manager" />
      <main style={{ marginLeft: '220px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: BG, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={16} color={ACCENT} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>IRIS Assistant</div>
              <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
                {[
                  { label: 'Llama 3.3 70B', icon: <Zap size={8} /> },
                  { label: 'text-embedding-3-large', icon: null },
                  { label: 'Cohere rerank-v3.5', icon: null },
                  { label: 'pgvector', icon: null },
                ].map(({ label, icon }) => (
                  <span key={label} style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '4px', background: SURFACE_MID, border: `1px solid ${BORDER}`, color: DIM, display: 'flex', alignItems: 'center', gap: '3px' }}>
                    {icon}{label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={() => setMessages([])} title="Clear chat"
            style={{ padding: '6px', borderRadius: '7px', background: 'transparent', border: `1px solid ${BORDER}`, cursor: 'pointer', color: DIM, display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {messages.length === 0 && (
              <div style={{ maxWidth: '600px', margin: '20px auto 0', width: '100%' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                    <Bot size={24} color={ACCENT} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: TEXT, marginBottom: '6px' }}>IRIS Knowledge Base</h2>
                  <p style={{ fontSize: '13px', color: MUTED }}>Ask anything about IRIS projects, methods, and research</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => setInput(s)}
                      style={{ textAlign: 'left', padding: '12px 14px', borderRadius: '9px', background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED, fontSize: '12.5px', cursor: 'pointer', lineHeight: 1.45 }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', animation: 'fadeIn 0.2s ease' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '7px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px',
                  background: msg.role === 'user' ? 'rgba(45,203,122,0.12)' : '#1C2D42',
                  border: `1px solid ${BORDER}`,
                }}>
                  {msg.role === 'user' ? <User size={12} color={GREEN} /> : <Bot size={12} color={ACCENT} />}
                </div>

                <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>

                  {msg.searchQuery && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: DIM }}>
                      <Search size={10} color={DIM} />
                      Searched for: <em style={{ color: ACCENT }}>{msg.searchQuery}</em>
                    </div>
                  )}

                  <div style={{
                    padding: '12px 16px', borderRadius: '11px',
                    fontSize: '13.5px', lineHeight: 1.7, color: TEXT,
                    background: msg.role === 'user' ? 'rgba(45,203,122,0.07)' : SURFACE,
                    border: `1px solid ${BORDER}`,
                    borderTopRightRadius: msg.role === 'user' ? '3px' : '11px',
                    borderTopLeftRadius:  msg.role === 'assistant' ? '3px' : '11px',
                  }}>
                    {msg.role === 'assistant'
                      ? renderMarkdown(msg.content)
                      : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                    }
                  </div>

                  {/* Confidence + route badge */}
                  {msg.confidence && msg.role === 'assistant' && (
                    <ConfidenceBadge confidence={msg.confidence} routedVia={msg.routedVia} />
                  )}

                  {/* Source pills */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {msg.sources.slice(0, 5).map((s, j) => (
                        <span key={j} style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '3px 9px', borderRadius: '20px', fontSize: '10.5px',
                          background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED,
                        }}>
                          <FileText size={9} color={ACCENT} />
                          {s.file.replace('.pdf', '').slice(0, 38)} · p{s.page}
                          <span style={{ color: DIM, marginLeft: '2px' }}>{(s.similarity * 100).toFixed(0)}%</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.sources && msg.sources.length === 0
                   && !msg.confidence?.hasGraphFacts
                   && msg.routedVia !== 'synthesis' && msg.routedVia !== 'table' && (
                    <div style={{ fontSize: '11px', color: AMBER, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      ⚠ No relevant documents found above threshold
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={12} color={ACCENT} />
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '11px', borderTopLeftRadius: '3px', background: SURFACE, border: `1px solid ${BORDER}`, display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: ACCENT, opacity: 0.7, animation: `bounce 1.2s infinite ${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: '14px 24px 16px', borderTop: `1px solid ${BORDER}`, background: BG, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '10px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center',
              background: SURFACE, border: `1px solid ${BORDER}`,
              borderRadius: '10px', padding: '0 14px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="Ask anything about IRIS projects, methods, or research…"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', padding: '12px 0', fontSize: '14px', color: TEXT, fontFamily: 'inherit' }}
              />
            </div>
            <button onClick={send} disabled={!canSend} title="Send"
              style={{
                width: '44px', height: '44px', borderRadius: '10px', border: 'none', flexShrink: 0,
                background: canSend ? ACCENT : SURFACE_MID,
                color: canSend ? '#0B1220' : DIM,
                cursor: canSend ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: canSend ? `0 0 14px rgba(34,211,238,0.25)` : 'none',
                transition: 'all 0.15s',
              }}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes bounce { 0%,80%,100% { transform: scale(1); opacity: 0.4; } 40% { transform: scale(1.3); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  )
}
