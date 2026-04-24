'use client'
import { useState, useEffect, useMemo } from 'react'
import Sidebar from '@/components/Sidebar'
import { BookOpen, Search, FileText, ChevronDown, ChevronRight, Layers, SortAsc, SortDesc, Network, Cpu, Globe, Tag } from 'lucide-react'

interface Doc {
  source_file: string
  folder: string
  rag_tier: string
  rag_score: number
  chunk_count: number
  size_mb: number
}

interface GraphData {
  technologies: Array<{ name: string; category: string | null; project_count: number }>
  top_partners: Array<{ name: string; country: string | null; type: string | null; project_count: number }>
  country_distribution: Record<string, number>
  domain_distribution: Record<string, number>
  projects: Array<{ code: string; name: string | null; status: string | null; programme: string | null; iris_roles: string[] | null; trl_start: number | null; trl_end: number | null; consortium_size: number | null }>
}

const BG      = '#0B1220'
const SURFACE = '#111A2B'
const SURFACE_MID = '#162235'
const BORDER  = '#22304A'
const TEXT    = '#E6EDF7'
const MUTED   = '#8A9AB3'
const DIM     = '#4A5F7A'
const ACCENT  = '#22D3EE'

const TIER_META: Record<string, { label: string; color: string; bg: string }> = {
  'Tier 1 - Core':     { label: 'Core',     color: ACCENT,    bg: 'rgba(34,211,238,0.1)' },
  'Tier 1 - Relevant': { label: 'Relevant', color: '#2DCB7A', bg: 'rgba(45,203,122,0.1)' },
  'Tier 2 - Useful':   { label: 'Useful',   color: MUTED,     bg: 'rgba(138,154,179,0.08)' },
}

type SortKey = 'name' | 'chunks' | 'score'
type SortDir = 'asc' | 'desc'

export default function LibraryPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTier, setFilterTier] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [stats, setStats] = useState({ total_docs: 0, total_chunks: 0, tiers: {} as Record<string, number> })
  const [activeTab, setActiveTab] = useState<'documents' | 'graph'>('documents')
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphSearch, setGraphSearch] = useState('')
  const [graphView, setGraphView] = useState<'technologies' | 'partners' | 'domains' | 'projects'>('technologies')

  useEffect(() => {
    fetch('/api/library').then(r => r.json()).then(data => {
      setDocs(data.docs || [])
      setStats(data.stats || {})
      setExpandedFolders(new Set((data.docs || []).map((d: Doc) => d.folder)))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (activeTab === 'graph' && !graphData) {
      setGraphLoading(true)
      fetch('/api/library/graph').then(r => r.json()).then(d => { setGraphData(d); setGraphLoading(false) })
    }
  }, [activeTab, graphData])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return docs.filter(d => {
      const matchSearch = !q || d.source_file.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q)
      const matchTier = filterTier === 'all' || d.rag_tier === filterTier
      return matchSearch && matchTier
    })
  }, [docs, search, filterTier])

  const maxChunks = useMemo(() => Math.max(...docs.map(d => d.chunk_count), 1), [docs])

  const grouped = useMemo(() => {
    const map = new Map<string, Doc[]>()
    const sorted = [...filtered].sort((a, b) => {
      const va = sortKey === 'name' ? a.source_file : sortKey === 'chunks' ? a.chunk_count : a.rag_score
      const vb = sortKey === 'name' ? b.source_file : sortKey === 'chunks' ? b.chunk_count : b.rag_score
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
    for (const doc of sorted) {
      if (!map.has(doc.folder)) map.set(doc.folder, [])
      map.get(doc.folder)!.push(doc)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, sortKey, sortDir])

  function toggleFolder(folder: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      return next
    })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortKey === k
    return (
      <button onClick={() => toggleSort(k)}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, cursor: 'pointer',
          background: active ? 'rgba(34,211,238,0.1)' : SURFACE,
          border: `1px solid ${active ? ACCENT + '50' : BORDER}`,
          color: active ? ACCENT : MUTED,
          transition: 'all 0.12s',
        }}>
        {label}
        {active && (sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />)}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG }}>
      <Sidebar role="manager" />
      <main style={{ marginLeft: '220px', flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: '960px', padding: '28px 28px 60px', margin: '0 auto' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: '#1C2D42', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen size={17} color={ACCENT} />
              </div>
              <div>
                <h1 style={{ fontSize: '17px', fontWeight: 700, color: TEXT, margin: 0, lineHeight: 1.2 }}>Library</h1>
                <p style={{ fontSize: '12px', color: MUTED, margin: '3px 0 0' }}>
                  {activeTab === 'documents'
                    ? (filtered.length === docs.length ? `${docs.length} documents · ${stats.total_chunks?.toLocaleString()} chunks` : `${filtered.length} of ${docs.length} documents`)
                    : 'Knowledge graph explorer'}
                </p>
              </div>
            </div>
            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: '4px', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '9px', padding: '3px' }}>
              {([['documents', 'Documents', BookOpen], ['graph', 'Graph Explorer', Network]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setActiveTab(id as 'documents' | 'graph')} style={{
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
          </div>

          {/* ── Graph Explorer ─────────────────────────────────────── */}
          {activeTab === 'graph' && (
            <div>
              {/* Summary stats from graph */}
              {graphData && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '20px' }}>
                  {[
                    { label: 'Projects', value: graphData.projects.length, color: TEXT },
                    { label: 'Technologies', value: graphData.technologies.length, color: ACCENT },
                    { label: 'Partners', value: graphData.top_partners.length + '+', color: TEXT },
                    { label: 'Countries', value: Object.keys(graphData.country_distribution).length, color: '#2DCB7A' },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: '12px 14px', borderRadius: '10px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                      <p className="num" style={{ fontSize: '22px', fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                      <p style={{ fontSize: '11px', color: MUTED, margin: '3px 0 0' }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-view tabs */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {([['technologies', 'Technologies', Cpu], ['partners', 'Partners', Globe], ['domains', 'Domains', Tag], ['projects', 'Projects', Layers]] as const).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setGraphView(id as typeof graphView)} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    background: graphView === id ? 'rgba(34,211,238,0.1)' : SURFACE,
                    border: `1px solid ${graphView === id ? ACCENT + '50' : BORDER}`,
                    color: graphView === id ? ACCENT : MUTED,
                    transition: 'all 0.12s',
                  }}>
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
                <div style={{ flex: 1, minWidth: '180px', position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: DIM }} />
                  <input value={graphSearch} onChange={e => setGraphSearch(e.target.value)} placeholder={`Search ${graphView}…`} style={{
                    width: '100%', background: SURFACE, border: `1px solid ${BORDER}`,
                    borderRadius: '7px', padding: '7px 12px 7px 30px', fontSize: '13px',
                    color: TEXT, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                  }} />
                </div>
              </div>

              {graphLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...Array(8)].map((_, i) => <div key={i} style={{ height: '42px', borderRadius: '8px', background: SURFACE, opacity: 1 - i * 0.1 }} />)}
                </div>
              ) : graphData && graphView === 'technologies' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {graphData.technologies
                    .filter(t => !graphSearch || t.name.toLowerCase().includes(graphSearch.toLowerCase()) || (t.category || '').toLowerCase().includes(graphSearch.toLowerCase()))
                    .map((t, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <Cpu size={13} style={{ color: ACCENT, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '13px', color: TEXT, fontWeight: 500 }}>{t.name}</span>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(167,139,250,0.1)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.2)', textTransform: 'capitalize' }}>{t.category || 'other'}</span>
                        <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '40px', textAlign: 'right' }}>{t.project_count} proj.</span>
                      </div>
                    ))}
                </div>
              ) : graphData && graphView === 'partners' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {graphData.top_partners
                    .filter(p => !graphSearch || p.name.toLowerCase().includes(graphSearch.toLowerCase()) || (p.country || '').toLowerCase().includes(graphSearch.toLowerCase()))
                    .map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <Globe size={13} style={{ color: '#2DCB7A', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '13px', color: TEXT, fontWeight: 500 }}>{p.name}</span>
                        <span style={{ fontSize: '11px', color: MUTED }}>{p.country || '?'}</span>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(45,203,122,0.08)', color: '#2DCB7A', border: '1px solid rgba(45,203,122,0.2)', textTransform: 'capitalize' }}>{(p.type || 'unknown').replace(/_/g, ' ')}</span>
                        <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '40px', textAlign: 'right' }}>{p.project_count} proj.</span>
                      </div>
                    ))}
                </div>
              ) : graphData && graphView === 'domains' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {Object.entries(graphData.domain_distribution)
                    .sort(([,a],[,b]) => b - a)
                    .filter(([k]) => !graphSearch || k.toLowerCase().includes(graphSearch.toLowerCase()))
                    .map(([domain, count], i) => {
                      const maxCount = Math.max(...Object.values(graphData.domain_distribution))
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                          <Tag size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '13px', color: TEXT }}>{domain}</span>
                          <div style={{ width: '120px', height: '4px', borderRadius: '2px', background: '#1C2D42' }}>
                            <div style={{ height: '100%', width: `${Math.round((count/maxCount)*100)}%`, background: '#F59E0B', borderRadius: '2px' }} />
                          </div>
                          <span className="num" style={{ fontSize: '12px', color: MUTED, minWidth: '24px', textAlign: 'right' }}>{count}</span>
                        </div>
                      )
                    })}
                </div>
              ) : graphData && graphView === 'projects' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {graphData.projects
                    .filter(p => !graphSearch || (p.code + ' ' + (p.name || '')).toLowerCase().includes(graphSearch.toLowerCase()))
                    .map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <Layers size={13} style={{ color: ACCENT, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="num" style={{ fontSize: '12px', fontWeight: 700, color: ACCENT }}>{p.code}</span>
                          <span style={{ fontSize: '12px', color: MUTED, marginLeft: '8px' }}>{(p.name || '').slice(0, 60)}</span>
                        </div>
                        {p.status && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: p.status === 'active' ? 'rgba(45,203,122,0.1)' : 'rgba(138,154,179,0.08)', color: p.status === 'active' ? '#2DCB7A' : MUTED, border: `1px solid ${p.status === 'active' ? 'rgba(45,203,122,0.25)' : BORDER}` }}>{p.status}</span>}
                        {p.trl_start && p.trl_end && <span className="num" style={{ fontSize: '11px', color: MUTED }}>TRL {p.trl_start}→{p.trl_end}</span>}
                        {p.consortium_size && <span className="num" style={{ fontSize: '11px', color: DIM }}>{p.consortium_size} partners</span>}
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Documents view ─────────────────────────────────────── */}
          {activeTab === 'documents' && <>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'Documents',    value: stats.total_docs,                    color: TEXT },
              { label: 'Chunks',       value: stats.total_chunks?.toLocaleString(), color: TEXT },
              { label: 'Core',         value: stats.tiers?.['Tier 1 - Core'] || 0, color: ACCENT },
              { label: 'Relevant',     value: stats.tiers?.['Tier 1 - Relevant'] || 0, color: '#2DCB7A' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: '10px', background: SURFACE, border: `1px solid ${BORDER}` }}>
                <p className="num" style={{ fontSize: '22px', fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: '11px', color: MUTED, margin: '3px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: DIM }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search files or folders…"
                style={{
                  width: '100%', background: SURFACE, border: `1px solid ${BORDER}`,
                  borderRadius: '7px', padding: '8px 12px 8px 30px', fontSize: '13px',
                  color: TEXT, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }} />
            </div>

            {/* Tier filter pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(['all', 'Tier 1 - Core', 'Tier 1 - Relevant', 'Tier 2 - Useful'] as const).map(t => {
                const meta = t !== 'all' ? TIER_META[t] : null
                const active = filterTier === t
                return (
                  <button key={t} onClick={() => setFilterTier(t)} style={{
                    padding: '5px 11px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                    background: active ? (meta?.bg || 'rgba(34,211,238,0.1)') : SURFACE,
                    border: `1px solid ${active ? (meta?.color || ACCENT) + '50' : BORDER}`,
                    color: active ? (meta?.color || ACCENT) : MUTED,
                    transition: 'all 0.12s',
                  }}>
                    {t === 'all' ? 'All Tiers' : meta?.label}
                  </button>
                )
              })}
            </div>

            {/* Sort */}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: DIM }}>Sort:</span>
              <SortBtn k="score" label="Score" />
              <SortBtn k="chunks" label="Chunks" />
              <SortBtn k="name" label="Name" />
            </div>
          </div>

          {/* Grouped list */}
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ height: '44px', borderRadius: '10px', background: SURFACE, opacity: 1 - i * 0.12 }} />
              ))}
            </div>
          ) : grouped.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', fontSize: '14px', color: MUTED }}>No documents found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {grouped.map(([folder, folderDocs]) => {
                const isOpen = expandedFolders.has(folder)
                return (
                  <div key={folder} style={{ borderRadius: '10px', overflow: 'hidden', border: `1px solid ${BORDER}` }}>
                    {/* Folder header — heavier than rows */}
                    <button
                      onClick={() => toggleFolder(folder)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '11px 14px', textAlign: 'left', cursor: 'pointer', border: 'none',
                        background: isOpen ? '#1C2D42' : SURFACE,
                        transition: 'background 0.12s',
                      }}>
                      <span style={{ color: MUTED, flexShrink: 0 }}>
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </span>
                      <Layers size={14} style={{ color: ACCENT, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder}
                      </span>
                      <span className="num" style={{
                        flexShrink: 0, fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(34,211,238,0.08)', color: ACCENT, border: `1px solid ${ACCENT}25`,
                      }}>
                        {folderDocs.length}
                      </span>
                    </button>

                    {/* File rows */}
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${BORDER}` }}>
                        {folderDocs.map((doc, i) => {
                          const meta = TIER_META[doc.rag_tier]
                          const barWidth = Math.round((doc.chunk_count / maxChunks) * 100)
                          return (
                            <div key={i}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '10px 14px 10px 38px',
                                background: i % 2 === 0 ? '#0E1828' : BG,
                                borderBottom: i < folderDocs.length - 1 ? `1px solid ${BORDER}20` : 'none',
                              }}>
                              <FileText size={13} style={{ color: DIM, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: '13px', fontWeight: 500, color: TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {doc.source_file}
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                  <div style={{ height: '3px', width: '80px', borderRadius: '2px', background: '#1C2D42', overflow: 'hidden', flexShrink: 0 }}>
                                    <div style={{ height: '100%', borderRadius: '2px', width: `${barWidth}%`, background: meta?.color || MUTED, opacity: 0.6 }} />
                                  </div>
                                  <span className="num" style={{ fontSize: '11px', color: MUTED }}>{doc.chunk_count} chunks</span>
                                </div>
                              </div>
                              <span style={{
                                flexShrink: 0, fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '5px',
                                background: meta?.bg || 'rgba(138,154,179,0.08)',
                                color: meta?.color || MUTED,
                                border: `1px solid ${meta?.color || MUTED}20`,
                              }}>
                                {meta?.label || doc.rag_tier}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          </> /* end documents view */}
        </div>
      </main>
    </div>
  )
}
