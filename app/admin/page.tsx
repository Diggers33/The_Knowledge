'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { Database, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, Search, ChevronDown, ChevronRight, FolderOpen, Network, Activity } from 'lucide-react'

interface LogEntry {
  source_path: string
  status: string
  chunks_inserted: number
  error_message: string | null
  processed_at: string
}

interface Stats {
  done: number
  failed: number
  skipped: number
  total_chunks: number
}

// Convert raw Python error dicts / long messages into readable text
function parseErrorFriendly(raw: string | null): { friendly: string; detail: string } {
  if (!raw) return { friendly: '', detail: '' }

  const s = raw.trim()

  // Python-dict style: {'message': '...', 'code': '...'} or {'code': '...', 'message': '...'}
  const msgMatch = s.match(/['"']message['"]:\s*['"]([^'"]+)['"]/)
  const codeMatch = s.match(/['"']code['"]:\s*['"](\d+)['"]/)
  const message = msgMatch ? msgMatch[1] : s
  const code = codeMatch ? codeMatch[1] : null

  const CODE_LABELS: Record<string, string> = {
    '57014': 'Ingestion timed out',
    '23505': 'Duplicate entry — already indexed',
    '42703': 'Schema mismatch',
    '53300': 'Too many connections',
  }

  const MSG_LABELS: Array<[RegExp, string]> = [
    [/canceling statement due to statement timeout/i, 'Ingestion timed out'],
    [/no extractable text/i,                          'No extractable text — scanned PDF?'],
    [/could not connect/i,                            'Database connection failed'],
    [/permission denied/i,                            'Permission denied'],
    [/out of memory/i,                                'Out of memory'],
    [/file not found|no such file/i,                  'File not found'],
    [/duplicate key/i,                                'Already indexed'],
    [/unique constraint/i,                            'Already indexed'],
    [/invalid byte sequence/i,                        'Encoding error — unexpected characters'],
    [/ssl/i,                                          'SSL connection error'],
    [/too many/i,                                     'Rate limit or connection limit reached'],
  ]

  if (code && CODE_LABELS[code]) {
    return { friendly: CODE_LABELS[code], detail: s }
  }

  for (const [pattern, label] of MSG_LABELS) {
    if (pattern.test(message)) {
      return { friendly: label, detail: s }
    }
  }

  // Truncate long raw messages
  const truncated = message.length > 80 ? message.slice(0, 80) + '…' : message
  return { friendly: truncated, detail: s }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function filename(path: string) {
  return path.split(/[\\/]/).pop() || path
}

const STATUS_META: Record<string, { icon: React.ReactNode; color: string }> = {
  done:    { icon: <CheckCircle size={13} />,  color: '#2DCB7A' },
  failed:  { icon: <XCircle size={13} />,      color: '#F87171' },
  skipped: { icon: <AlertCircle size={13} />,  color: '#F59E0B' },
}

interface GraphStats {
  totals: { projects: number; partners: number; technologies: number; iris_technologies: number; domains: number; edges: number }
  by_status: Record<string, number>
  by_programme: Record<string, number>
  by_tech_category: Record<string, number>
  coordinator_count: number
}

export default function AdminPage() {
  const [log, setLog] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats>({ done: 0, failed: 0, skipped: 0, total_chunks: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [activeTab, setActiveTab] = useState<'ingestion' | 'graph'>('ingestion')
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  const fetchLog = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/log')
    const data = await res.json()
    setLog(data.log || [])
    setStats(data.stats || {})
    setLoading(false)
    setCountdown(30)
  }, [])

  useEffect(() => { fetchLog() }, [fetchLog])

  useEffect(() => {
    if (activeTab === 'graph' && !graphStats) {
      setGraphLoading(true)
      fetch('/api/admin/graph').then(r => r.json()).then(d => { setGraphStats(d); setGraphLoading(false) })
    }
  }, [activeTab, graphStats])

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (!autoRefresh) return
    intervalRef.current = setInterval(fetchLog, 30000)
    countdownRef.current = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [autoRefresh, fetchLog])

  const filtered = log.filter(l => {
    const matchStatus = filter === 'all' || l.status === filter
    const matchSearch = !search || filename(l.source_path).toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const total = stats.done + stats.failed + stats.skipped
  const pct = total > 0 ? Math.round((stats.done / total) * 100) : 0

  function toggleExpand(i: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const BG = '#080C20'
  const SURFACE = '#0D1235'
  const SURFACE_MID = '#121847'
  const BORDER = '#1E2B6A'
  const TEXT = '#E8EEFF'
  const MUTED = '#8A96C4'
  const DIM = '#4A5590'
  const ACCENT = '#4A9EFF'
  const GREEN = '#2DCB7A'

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG }}>
      <Sidebar role="manager" />
      <main style={{ marginLeft: '220px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 16px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, background: BG }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Database size={17} color={GREEN} />
              </div>
              <div>
                <h1 style={{ fontSize: '17px', fontWeight: 700, color: TEXT, margin: 0, lineHeight: 1.2 }}>Admin</h1>
                <p style={{ fontSize: '12px', color: MUTED, margin: '2px 0 0' }}>Ingestion pipeline & knowledge graph</p>
              </div>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: '4px', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '9px', padding: '3px' }}>
              {([['ingestion', 'Ingestion', Database], ['graph', 'Graph', Network]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setActiveTab(id as 'ingestion' | 'graph')} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: activeTab === id ? '#1C3A52' : 'transparent',
                  color: activeTab === id ? ACCENT : MUTED,
                  transition: 'all 0.12s',
                }}>
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'ingestion' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {autoRefresh && (
                  <span className="num" style={{ fontSize: '12px', color: DIM }}>
                    {countdown}s
                  </span>
                )}
                <button onClick={() => setAutoRefresh(a => !a)} style={{
                  padding: '6px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                  background: autoRefresh ? 'rgba(45,203,122,0.12)' : SURFACE,
                  border: `1px solid ${autoRefresh ? 'rgba(45,203,122,0.35)' : BORDER}`,
                  color: autoRefresh ? GREEN : MUTED,
                  transition: 'all 0.12s',
                }}>
                  Auto-refresh
                </button>
                <button onClick={fetchLog} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer',
                  background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED,
                }}>
                  <RefreshCw size={12} className={loading ? 'spin' : ''} />
                  Refresh
                </button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '14px' }}>
            {[
              { label: 'Ingested',     value: stats.done,                        color: TEXT },
              { label: 'Failed',       value: stats.failed,                      color: stats.failed > 0 ? '#F87171' : TEXT },
              { label: 'Skipped',      value: stats.skipped,                     color: TEXT },
              { label: 'Total Chunks', value: stats.total_chunks?.toLocaleString(), color: TEXT },
            ].map((s, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: '10px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                <p className="num" style={{ fontSize: '22px', fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: '11px', color: MUTED, margin: '3px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '10px', background: SURFACE, border: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '7px', color: MUTED }}>
                <span>Ingestion Progress</span>
                <span className="num" style={{ color: pct === 100 ? '#2DCB7A' : TEXT, fontWeight: 600 }}>{pct}%</span>
              </div>
              <div style={{ height: '5px', borderRadius: '3px', background: '#1C2D42', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '3px', width: `${pct}%`, background: pct === 100 ? '#2DCB7A' : '#4A9EFF', transition: 'width 0.6s ease' }} />
              </div>
              {stats.failed > 0 && (
                <p style={{ fontSize: '11px', color: '#F87171', margin: '6px 0 0' }}>
                  {stats.failed} file{stats.failed !== 1 ? 's' : ''} failed — expand rows below for details
                </p>
              )}
            </div>
          )}

          {/* Ingestion-only controls — pinned */}
          {activeTab === 'ingestion' && <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px', position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: DIM }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter by filename..."
                style={{
                  width: '100%', background: SURFACE_MID, border: `1px solid ${BORDER}`,
                  borderRadius: '7px', padding: '7px 12px 7px 30px', fontSize: '13px',
                  color: TEXT, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }} />
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['all', 'done', 'failed', 'skipped'] as const).map(f => {
                const meta = STATUS_META[f]
                const active = filter === f
                const count = f === 'all' ? log.length : log.filter(l => l.status === f).length
                return (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 11px', borderRadius: '7px', fontSize: '12px', fontWeight: 500,
                    cursor: 'pointer', textTransform: 'capitalize',
                    background: active ? (meta ? `${meta.color}18` : 'rgba(34,211,238,0.12)') : SURFACE,
                    border: `1px solid ${active ? (meta?.color || '#22D3EE') + '50' : BORDER}`,
                    color: active ? (meta?.color || '#22D3EE') : MUTED,
                    transition: 'all 0.12s',
                  }}>
                    {f !== 'all' && <span style={{ color: meta?.color }}>{meta?.icon}</span>}
                    {f} <span style={{ opacity: 0.6, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>({count})</span>
                  </button>
                )
              })}
            </div>
          </div>}
        </div>

        {/* ── Graph Stats Panel ─────────────────────────────────────────── */}
        {activeTab === 'graph' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {graphLoading || !graphStats ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ height: '80px', borderRadius: '10px', background: SURFACE, opacity: 1 - i * 0.1 }} />
                ))}
              </div>
            ) : (
              <>
                {/* Totals */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '10px', marginBottom: '20px' }}>
                  {[
                    { label: 'Projects',       value: graphStats.totals.projects,         color: TEXT },
                    { label: 'Partners',        value: graphStats.totals.partners,         color: TEXT },
                    { label: 'Technologies',    value: graphStats.totals.technologies,     color: TEXT },
                    { label: 'IRIS-Developed',  value: graphStats.totals.iris_technologies,color: ACCENT },
                    { label: 'Domains',         value: graphStats.totals.domains,          color: TEXT },
                    { label: 'Coordinators',    value: graphStats.coordinator_count,       color: GREEN },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: '14px', borderRadius: '10px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                      <p className="num" style={{ fontSize: '24px', fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                      <p style={{ fontSize: '11px', color: MUTED, margin: '4px 0 0' }}>{s.label}</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  {/* By Status */}
                  <div style={{ padding: '16px', borderRadius: '12px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: DIM, margin: '0 0 12px' }}>Project Status</p>
                    {Object.entries(graphStats.by_status).sort(([,a],[,b]) => b - a).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', color: TEXT, textTransform: 'capitalize' }}>{k || 'unknown'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: '#1C2D42', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round((v / graphStats.totals.projects) * 100)}%`, background: k === 'active' ? GREEN : ACCENT, borderRadius: '2px' }} />
                          </div>
                          <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '24px', textAlign: 'right' }}>{v}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* By Programme */}
                  <div style={{ padding: '16px', borderRadius: '12px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: DIM, margin: '0 0 12px' }}>Funding Programme</p>
                    {Object.entries(graphStats.by_programme).sort(([,a],[,b]) => b - a).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', color: TEXT }}>{k || 'unknown'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: '#1C2D42', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round((v / graphStats.totals.projects) * 100)}%`, background: ACCENT, borderRadius: '2px' }} />
                          </div>
                          <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '24px', textAlign: 'right' }}>{v}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* By Tech Category */}
                  <div style={{ padding: '16px', borderRadius: '12px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: DIM, margin: '0 0 12px' }}>Technology Categories</p>
                    {Object.entries(graphStats.by_tech_category).sort(([,a],[,b]) => b - a).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', color: TEXT, textTransform: 'capitalize' }}>{k || 'unknown'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: '#1C2D42', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round((v / graphStats.totals.technologies) * 100)}%`, background: '#A78BFA', borderRadius: '2px' }} />
                          </div>
                          <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '24px', textAlign: 'right' }}>{v}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Scrollable ingestion table body ──────────────────────────── */}
        {activeTab === 'ingestion' && <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Sticky column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 100px 90px 24px',
            padding: '8px 24px',
            position: 'sticky', top: 0, zIndex: 5,
            background: '#0E1726',
            borderBottom: `1px solid ${BORDER}`,
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: DIM,
          }}>
            <span />
            <span>File</span>
            <span style={{ textAlign: 'right' }}>Chunks</span>
            <span style={{ textAlign: 'right' }}>When</span>
            <span />
          </div>

          {loading ? (
            <div>
              {[...Array(10)].map((_, i) => (
                <div key={i} style={{
                  height: '46px', margin: '1px 0', padding: '0 24px',
                  display: 'flex', alignItems: 'center',
                  background: i % 2 === 0 ? SURFACE : '#0E1726',
                  opacity: 1 - i * 0.06,
                }}>
                  <div style={{ height: '12px', width: '40%', borderRadius: '4px', background: SURFACE_MID, animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', fontSize: '14px', color: MUTED }}>
              No entries match
            </div>
          ) : (
            <div>
              {filtered.slice(0, 500).map((entry, i) => {
                const meta = STATUS_META[entry.status]
                const isOpen = expanded.has(i)
                const { friendly, detail } = parseErrorFriendly(entry.error_message)
                const hasDetail = !!entry.error_message || entry.source_path.length > 40
                return (
                  <div key={i} style={{ borderBottom: `1px solid ${BORDER}20` }}>
                    <button
                      onClick={() => hasDetail && toggleExpand(i)}
                      style={{
                        width: '100%', display: 'grid', alignItems: 'center',
                        gridTemplateColumns: '32px 1fr 100px 90px 24px',
                        padding: '10px 24px', textAlign: 'left',
                        background: isOpen ? '#162235' : (i % 2 === 0 ? SURFACE : '#0E1726'),
                        border: 'none', cursor: hasDetail ? 'pointer' : 'default',
                        transition: 'background 0.1s',
                      }}>
                      <span style={{ color: meta?.color || DIM }}>
                        {meta?.icon || <Clock size={13} />}
                      </span>

                      <div style={{ minWidth: 0, paddingRight: '16px' }}>
                        <p style={{ fontSize: '13px', fontWeight: 500, color: TEXT, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'JetBrains Mono, monospace' }}>
                          {filename(entry.source_path)}
                        </p>
                        {friendly && (
                          <p style={{ fontSize: '11px', color: '#F87171', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {friendly}
                          </p>
                        )}
                      </div>

                      <span className="num" style={{ fontSize: '13px', textAlign: 'right', color: entry.chunks_inserted > 0 ? MUTED : DIM }}>
                        {entry.chunks_inserted > 0 ? entry.chunks_inserted.toLocaleString() : '—'}
                      </span>

                      <span className="num" style={{ fontSize: '12px', textAlign: 'right', color: MUTED }}>
                        {relativeTime(entry.processed_at)}
                      </span>

                      <span style={{ display: 'flex', justifyContent: 'flex-end', color: DIM }}>
                        {hasDetail && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                      </span>
                    </button>

                    {isOpen && (
                      <div style={{ padding: '10px 24px 12px 64px', background: '#0A1526', borderTop: `1px solid ${BORDER}20` }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                          <FolderOpen size={12} style={{ color: DIM, flexShrink: 0, marginTop: '1px' }} />
                          <p style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: MUTED, margin: 0, wordBreak: 'break-all', lineHeight: 1.6 }}>
                            {entry.source_path}
                          </p>
                        </div>
                        {detail && (
                          <div style={{ padding: '10px 12px', borderRadius: '7px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', marginTop: '6px' }}>
                            <p style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#F87171', margin: 0, wordBreak: 'break-all', lineHeight: 1.6 }}>
                              {detail}
                            </p>
                          </div>
                        )}
                        <p style={{ fontSize: '11px', color: DIM, margin: '8px 0 0' }}>
                          {new Date(entry.processed_at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
              {filtered.length > 500 && (
                <p style={{ textAlign: 'center', fontSize: '12px', padding: '16px', color: DIM }}>
                  Showing 500 of {filtered.length} entries
                </p>
              )}
            </div>
          )}
        </div>}
      </main>
    </div>
  )
}
