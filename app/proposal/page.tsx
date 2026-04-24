'use client'
import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import {
  Loader2, Download, ChevronRight, ChevronLeft, Plus, X,
  Check, AlertTriangle, PenLine, Users, Layers, Telescope,
  FileCheck, RefreshCw, FileText,
} from 'lucide-react'
import type { ProjectBrief, Partner, Concept, ResolvedCall, ComplianceResult, PartnerSuggestion } from '@/lib/proposal-types'
import type { ProposalTemplate, SectionTemplate } from '@/lib/proposal-templates'
import { TEMPLATES, detectTemplate } from '@/lib/proposal-templates'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'setup' | 'concept' | 'consortium' | 'write' | 'export'

const PHASE_ORDER: Phase[] = ['setup', 'concept', 'consortium', 'write', 'export']

const PHASE_LABELS: Record<Phase, string> = {
  setup:      'Call Setup',
  concept:    'Concept',
  consortium: 'Consortium',
  write:      'Document',
  export:     'Export',
}

// ─── COLOURS ──────────────────────────────────────────────────────────────────

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
  white:  '#FFFFFF',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const isSubsection = (sec: SectionTemplate) => /^\d+\.\d/.test(sec.title)
const wordCount    = (text: string) => text.split(/\s+/).filter(Boolean).length
const isCallId     = (t: string) => /^HORIZON[-\s][A-Z0-9][-A-Z0-9\s]*$/i.test(t.trim())

function extractCitationsWithTitles(sections: Record<string, string>): Array<{ citation: string; title: string; doi?: string }> {
  const seen = new Set<string>()
  const results: Array<{ citation: string; title: string; doi?: string }> = []

  for (const text of Object.values(sections)) {
    const refBlock = text.split('---\n**References**')[1]
    if (!refBlock) continue

    // Each APA line starts with Author (Year). or Author, A. (Year).
    const lines = refBlock.split('\n').map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      // Extract author+year key: "Author (Year)"
      const keyMatch = line.match(/^([A-Z][a-záéíóúüñ]+(?:[,\s]+(?:[A-Z]\.?\s*)+)?(?:\s+et\s+al\.?)?(?:\s*[,&]\s*[A-Z][a-záéíóúüñ]+(?:[,\s]+(?:[A-Z]\.?\s*)+)?)*)\s*\((\d{4})\)/)
      if (!keyMatch) continue
      const citation = `${keyMatch[1].trim()} (${keyMatch[2]})`
      if (seen.has(citation)) continue
      seen.add(citation)

      // Extract title: text between first ". " after year and next ". " (italic markers stripped)
      const afterYear = line.slice(keyMatch[0].length)
      const titleMatch = afterYear.match(/^\.\s+\*?([^.*][^.]{10,200}?)\*?\./)
      const title = titleMatch ? titleMatch[1].trim() : citation

      // Extract DOI URL if present
      const doiMatch = line.match(/https?:\/\/doi\.org\/[^\s)>]+/)
      const arxivMatch = line.match(/https?:\/\/arxiv\.org\/abs\/[^\s)>]+/)
      const doi = doiMatch?.[0] ?? arxivMatch?.[0]

      results.push({ citation, title, doi })
    }
  }

  // Fallback: scan in-text citations not captured from reference block
  const citationPattern = /([A-Z][a-záéíóúü]+(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][a-záéíóúü]+)?)\s*\((\d{4})\)/g
  for (const text of Object.values(sections)) {
    const mainText = text.split('---\n**References**')[0]
    const pattern = new RegExp(citationPattern.source, 'g')
    let match
    while ((match = pattern.exec(mainText)) !== null) {
      const citation = `${match[1].trim()} (${match[2]})`
      if (!seen.has(citation)) {
        seen.add(citation)
        results.push({ citation, title: citation })
      }
    }
  }

  return results.sort((a, b) => a.citation.localeCompare(b.citation))
}

function semanticScholarUrl(citation: string, title?: string): string {
  const query = title && title !== citation ? title : citation.replace(/\[.*?\]/g, '').trim()
  return `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}&sort=Relevance`
}

function googleScholarUrl(citation: string, title?: string): string {
  const query = title && title !== citation ? title : citation.replace(/\[.*?\]/g, '').trim()
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`
}

function getSectionStatus(
  sec: SectionTemplate,
  sections: Record<string, string>,
  generatingSection: string
): 'complete' | 'generating' | 'review' | 'empty' {
  if (generatingSection === sec.id) return 'generating'
  const text = sections[sec.id] || ''
  if (!text.trim()) return 'empty'
  const words = wordCount(text)
  const ratio = words / (sec.words || 400)
  if (ratio < 0.7 || ratio > 1.15) return 'review'
  return 'complete'
}

// ─── SHARED STYLE PRIMITIVES ──────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.panel, border: `1px solid ${C.border}`,
  borderRadius: '14px', padding: '20px', marginBottom: '16px',
}

const label: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: C.muted, marginBottom: '10px', display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.input, border: `1px solid ${C.border}`,
  borderRadius: '10px', padding: '11px 14px', fontSize: '14px',
  fontFamily: 'inherit', color: C.white, outline: 'none',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: 'none', lineHeight: 1.6,
}

const btn = (variant: 'primary' | 'secondary' | 'danger' | 'ghost', disabled = false): React.CSSProperties => ({
  padding: '10px 18px', borderRadius: '10px',
  border: variant === 'secondary' ? `1px solid rgba(0,196,212,0.25)` :
          variant === 'ghost'     ? `1px solid ${C.border}` : 'none',
  background: disabled ? C.input :
    variant === 'primary'   ? C.cyan :
    variant === 'secondary' ? 'rgba(0,196,212,0.12)' :
    variant === 'danger'    ? 'rgba(248,113,113,0.12)' :
    'transparent',
  color: disabled ? C.muted :
    variant === 'primary' ? C.bg :
    variant === 'danger'  ? C.red :
    C.cyan,
  fontSize: '13px', fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'default' : 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: '7px',
  transition: 'all 0.15s',
})

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ProposalPage() {

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('setup')

  // ── Setup ──────────────────────────────────────────────────────────────────
  const [callText, setCallText]         = useState('')
  const [callResolved, setCallResolved] = useState<ResolvedCall | null>(null)
  const [resolving, setResolving]       = useState(false)
  const [stageSelected, setStageSelected] = useState<'stage1' | 'stage2' | 'single'>('stage2')
  const [scopeSelected, setScopeSelected] = useState('')
  const [setupError, setSetupError]     = useState('')

  // ── Concept ────────────────────────────────────────────────────────────────
  const [concepts, setConcepts]             = useState<Concept[]>([])
  const [conceptsLoading, setConceptsLoading] = useState(false)
  const [conceptError, setConceptError]     = useState('')
  const [brief, setBrief]                   = useState<ProjectBrief | null>(null)
  const [editingBrief, setEditingBrief]     = useState(false)

  // ── Consortium ─────────────────────────────────────────────────────────────
  const [partners, setPartners] = useState<Partner[]>([{
    id: 'iris', name: 'IRIS Technology Solutions', acronym: 'IRIS',
    country: 'ES', type: 'sme', role: 'Coordinator',
    speciality: 'NIR spectroscopy, hyperspectral imaging, PAT, AI/ML',
    source: 'manual',
  }])
  const [consortiumSuggestions, setConsortiumSuggestions] = useState<Array<{role: string; partners: PartnerSuggestion[]}>>([])
  const [geographicGaps, setGeographicGaps] = useState<string[]>([])
  const [profileWarnings, setProfileWarnings] = useState<string[]>([])
  const [consortiumLoading, setConsortiumLoading] = useState(false)

  // Recompute consortium warnings on every partner list mutation — no stale state
  useEffect(() => {
    const countries = new Set(partners.map(p => p.country).filter(Boolean))
    const hasResearch = partners.some(p => p.type === 'university' || p.type === 'research_institute')
    const warnings: string[] = []
    if (countries.size < 3) {
      warnings.push(`Fewer than 3 EU countries (currently: ${[...countries].join(', ') || 'none'})`)
    }
    if (!hasResearch) {
      warnings.push('No research organisation (university or research institute) in consortium')
    }
    setProfileWarnings(warnings)
  }, [partners])
  const [existingProposal, setExistingProposal] = useState('')
  const [uploadingProposal, setUploadingProposal] = useState(false)
  const [proposalUploadInfo, setProposalUploadInfo] = useState<{ wordCount: number; sectionsFound: string[] } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [manualForm, setManualForm] = useState<{ name: string; acronym: string; country: string; type: Partner['type']; role: string }>({
    name: '', acronym: '', country: '', type: 'university', role: ''
  })

  // ── Write ──────────────────────────────────────────────────────────────────
  const [sections, setSections]               = useState<Record<string, string>>({})
  const [activeSection, setActiveSection]     = useState('')
  const [sectionContexts, setSectionContexts] = useState<Record<string, string>>({})
  const [generating, setGenerating]           = useState(false)
  const [generatingSection, setGeneratingSection] = useState('')
  const [writeError, setWriteError]           = useState('')

  // ── Export ─────────────────────────────────────────────────────────────────
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null)
  const [complianceLoading, setComplianceLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // ─── Derived template ──────────────────────────────────────────────────────
  const templateKey = callResolved ? `${callResolved.actionType}_${stageSelected}` : null
  const template: ProposalTemplate | null = templateKey
    ? (TEMPLATES[templateKey] || TEMPLATES['RIA_stage2'])
    : null

  const writableSections = template?.sections.filter(isSubsection) || []
  const activeIdx = writableSections.findIndex(s => s.id === activeSection)

  // ─── localStorage persistence ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('iris_proposal_draft')
      if (!saved) return
      const d = JSON.parse(saved)
      if (d.callText)      setCallText(d.callText)
      if (d.callResolved)  setCallResolved(d.callResolved)
      if (d.stageSelected) setStageSelected(d.stageSelected)
      if (d.scopeSelected) setScopeSelected(d.scopeSelected)
      if (d.brief)         setBrief(d.brief)
      if (d.partners)      setPartners(d.partners)
      if (d.sections)      setSections(d.sections)
      if (d.phase)         setPhase(d.phase)
      if (d.concepts)      setConcepts(d.concepts)
      if (d.activeSection) setActiveSection(d.activeSection)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('iris_proposal_draft', JSON.stringify({
        callText, callResolved, stageSelected, scopeSelected,
        brief, partners, sections, phase, concepts, activeSection,
      }))
    } catch {}
  }, [callText, callResolved, stageSelected, scopeSelected, brief, partners, sections, phase, concepts, activeSection])

  // Set default active section when entering write phase
  useEffect(() => {
    if (phase === 'write' && template && !activeSection) {
      const first = writableSections[0]
      if (first) setActiveSection(first.id)
    }
  }, [phase, template])

  // Auto-run compliance when entering export
  useEffect(() => {
    if (phase === 'export' && !complianceResult) {
      runCompliance()
    }
  }, [phase])

  // ─── HANDLERS ─────────────────────────────────────────────────────────────

  async function resolveCall() {
    if (!callText.trim()) return
    setResolving(true)
    setSetupError('')
    try {
      const res = await fetch('/api/proposal/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Resolution failed')
      setCallResolved(data)
      if (data.isTwoStage && stageSelected === 'single') setStageSelected('stage1')
      if (data.scopes?.length && !scopeSelected) setScopeSelected(data.scopes[0] || '')
    } catch (e: any) {
      setSetupError(e.message)
    }
    setResolving(false)
  }

  async function generateConcepts() {
    setConceptsLoading(true)
    setConceptError('')
    setConcepts([])
    try {
      const res = await fetch('/api/proposal/concept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callText:      callResolved?.description || callText,
          callId:        callResolved?.callId || '',
          scopeSelected: scopeSelected,
          actionType:    callResolved?.actionType || 'RIA',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Concept generation failed')
      setConcepts(data.concepts || [])
    } catch (e: any) {
      setConceptError(e.message)
    }
    setConceptsLoading(false)
  }

  function selectConcept(concept: Concept) {
    const tpl = template || detectTemplate(callResolved?.description || callText)
    setBrief({
      callId:                  callResolved?.callId || 'CUSTOM',
      callTitle:               callResolved?.callTitle || '',
      actionType:              callResolved?.actionType || tpl.actionType,
      stage:                   stageSelected,
      scopeSelected:           scopeSelected,
      projectTitle:            concept.title,
      acronym:                 concept.acronym,
      coreInnovation:          concept.coreInnovation,
      whyBeyondSotA:           concept.whyBeyondSotA,
      competitiveDifferentiator: concept.competitiveDifferentiator,
      irisRole:                concept.irisRole,
      irisWPs:                 ['1', '2'],
      irisTechnologies:        concept.irisTechnologies,
      trlStart:                concept.trlStart,
      trlEnd:                  concept.trlEnd,
      pilots:                  concept.pilots,
      partners:                partners,
      template:                tpl,
    })
    setEditingBrief(true)
  }

  function createBlankBrief(): ProjectBrief {
    const tpl = template || detectTemplate(callResolved?.description || callText)
    return {
      callId:                    callResolved?.callId || 'CUSTOM',
      callTitle:                 callResolved?.callTitle || '',
      actionType:                callResolved?.actionType || tpl.actionType,
      stage:                     stageSelected,
      scopeSelected:             scopeSelected,
      projectTitle:              '',
      acronym:                   '',
      coreInnovation:            '',
      whyBeyondSotA:             '',
      competitiveDifferentiator: '',
      irisRole:                  '',
      irisWPs:                   ['1', '2'],
      irisTechnologies:          ['NIR spectroscopy', 'AI/ML'],
      trlStart:                  4,
      trlEnd:                    6,
      pilots:                    [],
      partners:                  partners,
      template:                  tpl,
    }
  }

  async function fetchConsortium() {
    if (!brief) return
    setConsortiumLoading(true)
    try {
      const res = await fetch('/api/proposal/consortium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: { ...brief, partners }, rolesNeeded: [] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setConsortiumSuggestions(data.suggestions || [])
      setGeographicGaps(data.geographicGaps || [])
      setProfileWarnings(data.profileWarnings || [])
    } catch (e: any) {
      console.error('Consortium error:', e)
    }
    setConsortiumLoading(false)
  }

  function addPartner(suggestion: PartnerSuggestion, role: string) {
    if (partners.some(p => p.name.toLowerCase() === suggestion.name.toLowerCase())) return
    const partner: Partner = {
      id:           `p_${Date.now()}`,
      name:         suggestion.name,
      acronym:      suggestion.acronym,
      country:      suggestion.country,
      type:         suggestion.type,
      role:         role,
      speciality:   suggestion.speciality,
      previousWork: suggestion.previousWork,
      source:       suggestion.source,
    }
    const updated = [...partners, partner]
    setPartners(updated)
    if (brief) setBrief({ ...brief, partners: updated })
  }

  function removePartner(id: string) {
    const updated = partners.filter(p => p.id !== id)
    setPartners(updated)
    if (brief) setBrief({ ...brief, partners: updated })
  }

  async function uploadProposal(file: File) {
    setUploadingProposal(true)
    setUploadError('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/proposal/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setExistingProposal(data.text)
      setProposalUploadInfo({ wordCount: data.wordCount, sectionsFound: data.sectionsFound })
    } catch (e: any) {
      setUploadError(e.message || 'Upload failed')
    } finally {
      setUploadingProposal(false)
    }
  }

  function extractExistingSection(fullText: string, sectionId: string): string {
    if (!fullText) return ''
    if (sectionId === 'workplan') {
      const match = fullText.match(/(?:^|\n)(?:3\.1[^\n]*)([\s\S]+?)(?=\n3\.2|\n4\.|\n5\.|$)/)
      return match ? match[1].trim() : ''
    }
    return ''
  }

  function addManualPartner() {
    if (!manualForm.name.trim()) return
    const p: Partner = {
      id: `manual_${Date.now()}`,
      name: manualForm.name.trim(),
      acronym: manualForm.acronym.trim() || manualForm.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase(),
      country: manualForm.country.trim().toUpperCase().slice(0, 2),
      type: manualForm.type,
      role: manualForm.role.trim() || 'Partner',
      speciality: '',
      source: 'manual',
    }
    const updated = [...partners, p]
    setPartners(updated)
    if (brief) setBrief({ ...brief, partners: updated })
    setManualForm({ name: '', acronym: '', country: '', type: 'university', role: '' })
  }

  async function generateSection(sectionId: string) {
    if (!callText && !callResolved) return
    setGenerating(true)
    setGeneratingSection(sectionId)
    setWriteError('')

    const fullBrief = brief ? { ...brief, partners } : null
    const tpl = template || (brief?.template ?? null)
    const secTemplate = tpl?.sections.find(s => s.id === sectionId)

    try {
      const existingSectionDraft = extractExistingSection(existingProposal, sectionId)
      const baseContext = sectionContexts[sectionId] || ''
      const additionalContext = existingSectionDraft
        ? `EXISTING DRAFT — expand and improve this, do not replace the structure or partners:\n\n${existingSectionDraft}${baseContext ? `\n\n${baseContext}` : ''}`
        : baseContext

      const res = await fetch('/api/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section:           sectionId,
          callText:          callResolved?.description || callText,
          additionalContext,
          existingDraft:     existingSectionDraft,
          pageLimit:         secTemplate?.pages || 2,
          sessionSections:   sections,
          brief:             fullBrief,
          template:          tpl,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setSections(prev => ({ ...prev, [sectionId]: text }))
      }
    } catch (e: any) {
      setWriteError(e.message || 'Generation failed')
    }

    setGenerating(false)
    setGeneratingSection('')
  }

  async function runCompliance() {
    if (!brief || !template) return
    setComplianceLoading(true)
    try {
      const res = await fetch('/api/proposal/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections,
          brief:    { ...brief, partners },
          callText: callResolved?.description || callText,
          template,
        }),
      })
      const data = await res.json()
      setComplianceResult(data)
    } catch (e: any) {
      console.error('Compliance error:', e)
    }
    setComplianceLoading(false)
  }

  async function exportDocx() {
    if (!brief || !template) return
    setExporting(true)
    setExportError('')
    try {
      const res = await fetch('/api/proposal/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections,
          brief:    { ...brief, partners },
          template,
        }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `IRIS_${(brief.acronym || 'PROPOSAL').replace(/\s+/g, '_')}_PartB.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setExportError(e.message)
    }
    setExporting(false)
  }

  function clearDraft() {
    localStorage.removeItem('iris_proposal_draft')
    setCallText(''); setCallResolved(null); setBrief(null); setConcepts([])
    setPartners([{
      id: 'iris', name: 'IRIS Technology Solutions', acronym: 'IRIS',
      country: 'ES', type: 'sme', role: 'Coordinator',
      speciality: 'NIR spectroscopy, hyperspectral imaging, PAT, AI/ML',
      source: 'manual',
    }])
    setSections({}); setActiveSection(''); setScopeSelected('')
    setStageSelected('stage2'); setPhase('setup'); setComplianceResult(null)
  }

  // ─── LEFT PANEL ────────────────────────────────────────────────────────────

  const phaseIdx = PHASE_ORDER.indexOf(phase)
  const completedSections = writableSections.filter(s => (sections[s.id] || '').trim()).length
  const totalWords        = Object.values(sections).reduce((sum, t) => sum + wordCount(t), 0)
  const estPages          = Math.round(totalWords / 400 * 10) / 10

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg }}>
      <Sidebar role="manager" />

      {/* Left phase + outline panel */}
      <div style={{
        marginLeft: '220px', width: '196px', flexShrink: 0,
        background: '#091F29', borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        position: 'fixed', top: 0, bottom: 0, left: 0,
        paddingTop: '20px',
      }}>
        {/* Phase Stepper */}
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', color: C.muted, textTransform: 'uppercase', marginBottom: '12px', paddingLeft: '4px' }}>
            Progress
          </div>
          <div style={{ position: 'relative' }}>
            {/* Connecting line */}
            <div style={{
              position: 'absolute', left: '18px', top: '18px',
              width: '2px', bottom: '18px',
              background: `linear-gradient(to bottom, ${C.green} ${Math.round((phaseIdx / (PHASE_ORDER.length - 1)) * 100)}%, #1A2840 ${Math.round((phaseIdx / (PHASE_ORDER.length - 1)) * 100)}%)`,
              transition: 'background 0.4s ease',
            }} />

            {PHASE_ORDER.map((p, i) => {
              const isActive    = phase === p
              const isCompleted = i < phaseIdx
              const canClick    = i <= phaseIdx
              return (
                <div
                  key={p}
                  onClick={() => canClick && setPhase(p)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '5px 8px 5px 6px', borderRadius: '8px', marginBottom: '4px',
                    cursor: canClick ? 'pointer' : 'default',
                    background: isActive ? 'rgba(34,211,238,0.08)' : 'transparent',
                    transition: 'background 0.12s',
                    position: 'relative',
                  }}
                >
                  {/* Step circle */}
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1, transition: 'all 0.2s',
                    background: isCompleted
                      ? '#2DCB7A'
                      : isActive
                      ? '#22D3EE'
                      : '#1C2D42',
                    border: `2px solid ${isCompleted ? '#2DCB7A' : isActive ? '#22D3EE' : '#22304A'}`,
                    boxShadow: isActive ? '0 0 10px rgba(34,211,238,0.3)' : 'none',
                  }}>
                    {isCompleted ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0B1220" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span style={{
                        fontSize: '10px', fontWeight: 700,
                        color: isActive ? '#0B1220' : '#4A5F7A',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {i + 1}
                      </span>
                    )}
                  </div>

                  <span style={{
                    fontSize: '12px',
                    fontWeight: isActive ? 700 : isCompleted ? 500 : 400,
                    color: isActive ? '#E6EDF7' : isCompleted ? '#2DCB7A' : canClick ? '#8A9AB3' : '#4A5F7A',
                  }}>
                    {PHASE_LABELS[p]}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Document outline */}
        {template && (
          <>
            <div style={{ height: '1px', background: C.border, margin: '0 12px 12px' }} />
            <div style={{ padding: '0 12px', flex: 1 }}>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', color: C.muted, textTransform: 'uppercase', marginBottom: '10px', paddingLeft: '4px' }}>
                Document
              </div>
              {template.sections.map(sec => {
                const isSub   = isSubsection(sec)
                const status  = getSectionStatus(sec, sections, generatingSection)
                const isActive = activeSection === sec.id && phase === 'write'
                return (
                  <div
                    key={sec.id}
                    onClick={() => {
                      if (isSub) {
                        setActiveSection(sec.id)
                        if (phase !== 'write') setPhase('write')
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: isSub ? '4px 6px 4px 18px' : '5px 6px 3px 6px',
                      borderRadius: '6px', marginBottom: '1px',
                      cursor: isSub ? 'pointer' : 'default',
                      background: isActive ? 'rgba(0,196,212,0.1)' : 'transparent',
                      color: isSub
                        ? (isActive ? C.cyan : status === 'complete' ? C.green : status === 'review' ? C.amber : C.text)
                        : C.muted,
                      fontSize: isSub ? '11px' : '9px',
                      fontWeight: isSub ? 400 : 700,
                      letterSpacing: isSub ? 0 : '0.08em',
                      textTransform: isSub ? 'none' : 'uppercase',
                    }}
                  >
                    {isSub && (
                      <span style={{ fontSize: '9px', flexShrink: 0, width: '10px' }}>
                        {status === 'complete'   ? '✓' :
                         status === 'generating' ? '⟳' :
                         status === 'review'     ? '!' :
                         '●'}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sec.title.slice(0, 24)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Progress summary */}
            <div style={{ padding: '12px', margin: '8px 12px', background: C.panel, borderRadius: '10px', border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: '10px', color: C.muted, marginBottom: '4px' }}>
                {completedSections}/{writableSections.length} sections
              </div>
              <div style={{ fontSize: '10px', color: C.muted }}>
                ~{estPages} / {template.totalPages} pages
              </div>
            </div>
          </>
        )}

        {/* Clear draft */}
        <div style={{ padding: '12px' }}>
          <button
            onClick={clearDraft}
            style={{ ...btn('danger'), width: '100%', justifyContent: 'center', fontSize: '10px', padding: '6px 10px' }}
          >
            <X size={10} /> Clear draft
          </button>
        </div>
      </div>

      {/* Main content */}
      <main style={{
        marginLeft: `${220 + 196}px`, flex: 1, overflowY: 'auto',
      }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 28px 60px' }}>

          {/* ── PHASE 0: CALL SETUP ─────────────────────────────────────────── */}
          {phase === 'setup' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(0,196,212,0.15)', border: `1px solid rgba(0,196,212,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Telescope size={18} color={C.cyan} />
                </div>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.white, margin: 0 }}>IRIS Proposal Intelligence</h1>
                  <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>Enter a Horizon Europe call ID or paste the call description</p>
                </div>
              </div>

              <div style={card}>
                <span style={label}>Call Identifier or Topic Description</span>
                <textarea
                  value={callText}
                  onChange={e => { setCallText(e.target.value); setCallResolved(null); setSetupError('') }}
                  rows={6}
                  placeholder="HORIZON-CL4-2026-DIGITAL-EMERGING-53 or paste full call text..."
                  style={textareaStyle}
                />
                {isCallId(callText) && !callResolved && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: C.cyan, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: C.cyan, display: 'inline-block' }} />
                    Horizon Europe call ID detected — click Resolve to fetch from EU F&T Portal
                  </div>
                )}
                <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                  <button
                    onClick={resolveCall}
                    disabled={!callText.trim() || resolving}
                    style={btn(callResolved ? 'ghost' : 'primary', !callText.trim() || resolving)}
                  >
                    {resolving ? <><Loader2 size={13} className="spin" /> Resolving...</> : 'Resolve'}
                  </button>
                  {callResolved && (
                    <button onClick={() => setCallResolved(null)} style={btn('ghost')}>
                      <RefreshCw size={12} /> Re-resolve
                    </button>
                  )}
                </div>
              </div>

              {setupError && (
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.2)`, color: C.red, fontSize: '13px', marginBottom: '16px' }}>
                  {setupError}
                </div>
              )}

              {callResolved && (
                <div style={{ ...card, background: 'rgba(45,203,122,0.05)', border: `1px solid rgba(45,203,122,0.2)` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <Check size={16} color={C.green} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: C.green, marginBottom: '4px' }}>
                        Resolved: {callResolved.callId}
                      </div>
                      <div style={{ fontSize: '13px', color: C.text, marginBottom: '6px' }}>
                        {callResolved.callTitle}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: C.muted }}>Type: <span style={{ color: C.text }}>{callResolved.actionType}</span></span>
                        {callResolved.trlRange && <span style={{ fontSize: '11px', color: C.muted }}>{callResolved.trlRange}</span>}
                        {callResolved.isTwoStage && <span style={{ fontSize: '11px', color: C.amber }}>Two-stage call</span>}
                        {callResolved.budget && <span style={{ fontSize: '11px', color: C.muted }}>{callResolved.budget.slice(0, 60)}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stage selector */}
              <div style={card}>
                <span style={label}>Stage</span>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {(['stage1', 'stage2', 'single'] as const).map(s => (
                    <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '10px 16px', borderRadius: '10px', background: stageSelected === s ? 'rgba(0,196,212,0.12)' : C.input, border: `1px solid ${stageSelected === s ? C.cyan : C.border}`, color: stageSelected === s ? C.cyan : C.text, fontSize: '13px', fontWeight: stageSelected === s ? 600 : 400 }}>
                      <input type="radio" name="stage" value={s} checked={stageSelected === s} onChange={() => setStageSelected(s)} style={{ display: 'none' }} />
                      {s === 'stage1' ? 'Stage 1 (10 pp, blind)' : s === 'stage2' ? 'Stage 2 (43 pp, full)' : 'Single-stage'}
                    </label>
                  ))}
                </div>
              </div>

              {/* Scope selector */}
              <div style={card}>
                <span style={label}>Target Scope <span style={{ color: C.muted, fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: '10px' }}>— which topic area this proposal addresses</span></span>
                {callResolved?.scopes && callResolved.scopes.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {callResolved.scopes.map((scope, i) => (
                      <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '10px 14px', borderRadius: '10px', background: scopeSelected === scope ? 'rgba(0,196,212,0.10)' : C.input, border: `1px solid ${scopeSelected === scope ? C.cyan : C.border}`, color: scopeSelected === scope ? C.cyan : C.text, fontSize: '13px' }}>
                        <input type="radio" name="scope" value={scope} checked={scopeSelected === scope} onChange={() => setScopeSelected(scope)} style={{ marginTop: '2px', accentColor: C.cyan }} />
                        {scope}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={scopeSelected}
                    onChange={e => setScopeSelected(e.target.value)}
                    placeholder="Describe the targeted scope or innovation direction..."
                    style={inputStyle}
                  />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={() => { setPhase('concept'); generateConcepts() }}
                  disabled={!callText.trim()}
                  style={{ ...btn('primary', !callText.trim()), flexDirection: 'column', alignItems: 'flex-start', padding: '16px', gap: '4px' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px' }}>
                    <Layers size={14} /> Generate concept ideas
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 400, opacity: 0.8 }}>
                    AI generates 3 candidates from call + IRIS KB
                  </span>
                </button>
                <button
                  onClick={() => { setBrief(createBlankBrief()); setEditingBrief(true); setConcepts([]); setPhase('concept') }}
                  disabled={!callText.trim()}
                  style={{ ...btn('secondary', !callText.trim()), flexDirection: 'column', alignItems: 'flex-start', padding: '16px', gap: '4px' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px' }}>
                    <PenLine size={14} /> We have a concept
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 400, opacity: 0.8 }}>
                    Go straight to the brief form
                  </span>
                </button>
              </div>

              {/* Upload existing Part B */}
              <div style={{ ...card, marginTop: '8px' }}>
                <span style={label}>Upload existing Part B <span style={{ color: C.muted, fontWeight: 400, textTransform: 'none' as const, letterSpacing: 0, fontSize: '10px' }}>(optional)</span></span>
                {proposalUploadInfo ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <Check size={14} color={C.green} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: C.green, fontWeight: 600 }}>
                        {proposalUploadInfo.wordCount.toLocaleString()} words extracted
                      </div>
                      {proposalUploadInfo.sectionsFound.length > 0 && (
                        <div style={{ fontSize: '11px', color: C.muted, marginTop: '4px' }}>
                          Sections found: {proposalUploadInfo.sectionsFound.slice(0, 5).join(' · ')}
                          {proposalUploadInfo.sectionsFound.length > 5 ? ` +${proposalUploadInfo.sectionsFound.length - 5} more` : ''}
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px' }}>
                        Existing section text will be injected automatically when generating matching sections.
                      </div>
                    </div>
                    <button
                      onClick={() => { setExistingProposal(''); setProposalUploadInfo(null); setUploadError('') }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: '4px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'inline-block', cursor: 'pointer' }}>
                      <input
                        type="file"
                        accept=".doc,.docx,.pdf"
                        style={{ display: 'none' }}
                        onChange={e => { if (e.target.files?.[0]) uploadProposal(e.target.files[0]) }}
                      />
                      <span style={{ ...btn('ghost'), display: 'inline-flex', fontSize: '12px', pointerEvents: 'none' }}>
                        {uploadingProposal
                          ? <><Loader2 size={12} className="spin" /> Extracting...</>
                          : <><FileText size={12} /> Upload existing Part B (.doc, .docx or .pdf)</>
                        }
                      </span>
                    </label>
                    {uploadError && (
                      <div style={{ fontSize: '11px', color: C.red, marginTop: '6px' }}>{uploadError}</div>
                    )}
                    <div style={{ fontSize: '11px', color: C.muted, marginTop: '6px' }}>
                      Text will be used as structural foundation when generating sections — AI expands rather than replaces.
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── PHASE 1: CONCEPT GENERATOR ──────────────────────────────────── */}
          {phase === 'concept' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(0,196,212,0.15)', border: `1px solid rgba(0,196,212,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={18} color={C.cyan} />
                </div>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.white, margin: 0 }}>
                    {editingBrief && concepts.length === 0 ? 'Project Brief' : 'Concept Generator'}
                  </h1>
                  <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>
                    {editingBrief && concepts.length === 0
                      ? 'Fill in your concept details to continue'
                      : `${callResolved?.callId || 'Custom call'} · ${callResolved?.actionType || 'RIA'} · ${stageSelected}`
                    }
                  </p>
                </div>
                <button onClick={() => setPhase('setup')} style={{ ...btn('ghost'), marginLeft: 'auto', fontSize: '12px' }}>
                  <ChevronLeft size={12} /> Back
                </button>
              </div>

              {conceptsLoading && (
                <div style={{ ...card, textAlign: 'center', padding: '40px' }}>
                  <Loader2 size={24} color={C.cyan} className="spin" />
                  <div style={{ fontSize: '13px', color: C.muted, marginTop: '12px' }}>Generating 3 distinct project concepts from IRIS KB and call analysis...</div>
                </div>
              )}

              {conceptError && (
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.2)`, color: C.red, fontSize: '13px', marginBottom: '16px' }}>
                  {conceptError}
                  <button onClick={generateConcepts} style={{ ...btn('secondary'), marginLeft: '12px', fontSize: '11px', padding: '4px 10px' }}>Retry</button>
                </div>
              )}

              {!conceptsLoading && concepts.length === 0 && !conceptError && (
                <div style={{ ...card, textAlign: 'center', padding: '40px' }}>
                  <div style={{ fontSize: '13px', color: C.muted }}>No concepts generated yet.</div>
                  <button onClick={generateConcepts} style={{ ...btn('primary'), marginTop: '16px' }}>Generate Concepts</button>
                </div>
              )}

              {/* Concept cards */}
              {concepts.map((concept, i) => (
                <div key={i} style={{ ...card, marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: C.cyan, marginBottom: '4px' }}>
                        CONCEPT {String.fromCharCode(65 + i)}
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: C.white }}>{concept.title}</div>
                      <div style={{ fontSize: '13px', color: C.cyan, fontWeight: 600 }}>{concept.acronym}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, padding: '4px 10px', background: 'rgba(0,196,212,0.1)', border: `1px solid rgba(0,196,212,0.2)`, borderRadius: '20px', fontSize: '11px', color: C.cyan }}>
                      TRL {concept.trlStart} → {concept.trlEnd}
                    </div>
                  </div>

                  <div style={{ fontSize: '13px', color: C.text, lineHeight: 1.6, marginBottom: '10px' }}>
                    {concept.coreInnovation}
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>IRIS Role</div>
                      <div style={{ fontSize: '12px', color: C.text }}>{concept.irisRole}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Pilots</div>
                      <div style={{ fontSize: '12px', color: C.text }}>{concept.pilots.join(' · ')}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: C.muted, marginBottom: '12px', fontStyle: 'italic' }}>
                    Technologies: {concept.irisTechnologies.join(', ')}
                  </div>

                  <button
                    onClick={() => selectConcept(concept)}
                    style={btn('primary')}
                  >
                    Select this concept <ChevronRight size={13} />
                  </button>
                </div>
              ))}

              {/* Brief editing form (after concept selected) */}
              {editingBrief && brief && (
                <div style={{ ...card, border: `1px solid rgba(0,196,212,0.3)`, marginTop: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: C.cyan, marginBottom: '16px' }}>
                    Edit Project Brief — {brief.acronym}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <span style={label}>Project Title</span>
                      <input style={inputStyle} value={brief.projectTitle} onChange={e => setBrief({ ...brief, projectTitle: e.target.value })} />
                    </div>
                    <div>
                      <span style={label}>Acronym</span>
                      <input style={inputStyle} value={brief.acronym} onChange={e => setBrief({ ...brief, acronym: e.target.value.toUpperCase() })} />
                    </div>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <span style={label}>Core Innovation (2-3 sentences)</span>
                    <textarea rows={3} style={textareaStyle} value={brief.coreInnovation} onChange={e => setBrief({ ...brief, coreInnovation: e.target.value })} />
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <span style={label}>Why Beyond State of the Art</span>
                    <textarea rows={2} style={textareaStyle} value={brief.whyBeyondSotA} onChange={e => setBrief({ ...brief, whyBeyondSotA: e.target.value })} />
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <span style={label}>IRIS Role</span>
                    <textarea rows={2} style={textareaStyle} value={brief.irisRole} onChange={e => setBrief({ ...brief, irisRole: e.target.value })} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 80px', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <span style={label}>IRIS Technologies (comma-separated)</span>
                      <input style={inputStyle} value={brief.irisTechnologies.join(', ')} onChange={e => setBrief({ ...brief, irisTechnologies: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                    </div>
                    <div>
                      <span style={label}>Pilots / Sectors</span>
                      <input style={inputStyle} value={brief.pilots.join(', ')} onChange={e => setBrief({ ...brief, pilots: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                    </div>
                    <div>
                      <span style={label}>TRL Start</span>
                      <input type="number" min={1} max={9} style={inputStyle} value={brief.trlStart} onChange={e => setBrief({ ...brief, trlStart: parseInt(e.target.value) || 4 })} />
                    </div>
                    <div>
                      <span style={label}>TRL End</span>
                      <input type="number" min={1} max={9} style={inputStyle} value={brief.trlEnd} onChange={e => setBrief({ ...brief, trlEnd: parseInt(e.target.value) || 6 })} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => { setEditingBrief(false); setPhase('consortium'); fetchConsortium() }}
                      style={{ ...btn('primary'), flex: 1, justifyContent: 'center', padding: '13px' }}
                    >
                      Build Consortium <ChevronRight size={15} />
                    </button>
                    <button
                      onClick={() => { setEditingBrief(false); setPhase('write') }}
                      style={{ ...btn('ghost'), fontSize: '12px', whiteSpace: 'nowrap' }}
                      title="Skip consortium suggestions — use partners already added above"
                    >
                      Skip — consortium defined <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              )}

              {!editingBrief && concepts.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: C.muted, textAlign: 'center' }}>
                  Select a concept above to edit the brief and continue
                </div>
              )}
            </>
          )}

          {/* ── PHASE 2: CONSORTIUM BUILDER ─────────────────────────────────── */}
          {phase === 'consortium' && (
            <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(0,196,212,0.15)', border: `1px solid rgba(0,196,212,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={18} color={C.cyan} />
                  </div>
                  <div>
                    <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.white, margin: 0 }}>Consortium Builder</h1>
                    <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>
                      {brief?.acronym} · {partners.length} partners confirmed
                    </p>
                  </div>
                  <button onClick={() => setPhase('concept')} style={{ ...btn('ghost'), marginLeft: 'auto', fontSize: '12px' }}>
                    <ChevronLeft size={12} /> Back
                  </button>
                </div>

                {/* ── Manual entry form ───────────────────────────────────────── */}
                <div style={card}>
                  <span style={label}>Add partner manually</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <input
                      placeholder="Organisation name *"
                      value={manualForm.name}
                      onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))}
                      style={{ ...inputStyle, fontSize: '13px' }}
                    />
                    <input
                      placeholder="Acronym"
                      value={manualForm.acronym}
                      onChange={e => setManualForm(f => ({ ...f, acronym: e.target.value }))}
                      style={{ ...inputStyle, fontSize: '13px' }}
                    />
                    <input
                      placeholder="Country (2-letter, e.g. DE)"
                      maxLength={2}
                      value={manualForm.country}
                      onChange={e => setManualForm(f => ({ ...f, country: e.target.value }))}
                      style={{ ...inputStyle, fontSize: '13px' }}
                    />
                    <select
                      value={manualForm.type}
                      onChange={e => setManualForm(f => ({ ...f, type: e.target.value as Partner['type'] }))}
                      style={{ ...inputStyle, fontSize: '13px' }}
                    >
                      <option value="university">University</option>
                      <option value="research_institute">Research Institute</option>
                      <option value="sme">SME</option>
                      <option value="large_company">Large Company</option>
                      <option value="end_user">End User</option>
                      <option value="association">Association</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      placeholder="Role in project (e.g. WP2 Leader, End User, Technology Provider)"
                      value={manualForm.role}
                      onChange={e => setManualForm(f => ({ ...f, role: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addManualPartner()}
                      style={{ ...inputStyle, fontSize: '13px', flex: 1 }}
                    />
                    <button
                      onClick={addManualPartner}
                      disabled={!manualForm.name.trim()}
                      style={btn('secondary', !manualForm.name.trim())}
                    >
                      <Plus size={13} /> Add Partner
                    </button>
                  </div>
                </div>

                {/* ── Confirmed consortium ────────────────────────────────────── */}
                <div style={card}>
                  <span style={label}>Confirmed consortium ({partners.length} partners)</span>
                  {partners.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: C.input, marginBottom: '8px', border: `1px solid ${C.border}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: C.white }}>{p.acronym} <span style={{ color: C.muted, fontWeight: 400 }}>({p.country})</span></div>
                        {p.id === 'iris' ? (
                          <input
                            value={p.role}
                            onChange={e => {
                              const updated = partners.map(pr => pr.id === 'iris' ? { ...pr, role: e.target.value } : pr)
                              setPartners(updated)
                              if (brief) setBrief({ ...brief, partners: updated })
                            }}
                            placeholder="Role (e.g. Coordinator)"
                            style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: '11px', outline: 'none', width: '100%', padding: '2px 0', marginTop: '2px' }}
                          />
                        ) : (
                          <div style={{ fontSize: '11px', color: C.muted }}>{p.role} · {p.type.replace(/_/g, ' ')}</div>
                        )}
                      </div>
                      <button onClick={() => removePartner(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: '4px' }}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* ── Continue button (always shown when ≥2 partners) ─────────── */}
                {partners.length >= 2 && (
                  <button
                    onClick={() => setPhase('write')}
                    style={{ ...btn('primary'), width: '100%', justifyContent: 'center', padding: '14px', marginBottom: '16px' }}
                  >
                    Continue with current partners ({partners.length}) <ChevronRight size={15} />
                  </button>
                )}

                {/* Profile warnings */}
                {profileWarnings.length > 0 && (
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.2)`, marginBottom: '16px' }}>
                    {profileWarnings.map((w, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: C.amber, marginBottom: i < profileWarnings.length - 1 ? '4px' : 0 }}>
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Geographic gaps */}
                {geographicGaps.length > 0 && (
                  <div style={{ ...card, padding: '12px 16px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: C.muted }}>
                      Recommended countries to add: <span style={{ color: C.amber }}>{geographicGaps.join(', ')}</span>
                    </div>
                  </div>
                )}

                {/* ── Suggestions (optional) ──────────────────────────────────── */}
                <div style={{ fontSize: '11px', fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: '10px' }}>
                  Partner Suggestions (optional)
                </div>

                {consortiumLoading ? (
                  <div style={{ ...card, textAlign: 'center', padding: '32px' }}>
                    <Loader2 size={20} color={C.cyan} className="spin" />
                    <div style={{ fontSize: '12px', color: C.muted, marginTop: '10px' }}>Searching IRIS KB and OpenAIRE for partner suggestions...</div>
                  </div>
                ) : consortiumSuggestions.length > 0 ? (
                  <>
                    {consortiumSuggestions.map((group, gi) => group.partners.length > 0 && (
                      <div key={gi} style={card}>
                        <span style={label}>{group.role}</span>
                        {group.partners.map((p, pi) => (
                          <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: C.input, marginBottom: '8px', border: `1px solid ${C.border}` }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: C.white }}>
                                {p.name} <span style={{ color: C.muted, fontWeight: 400 }}>({p.country})</span>
                                <span style={{ marginLeft: '8px', color: p.fitScore >= 3 ? C.cyan : C.muted, fontSize: '11px' }}>
                                  {'★'.repeat(Math.max(0, Math.min(3, p.fitScore || 1)))}{'☆'.repeat(Math.max(0, 3 - Math.min(3, p.fitScore || 1)))}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px' }}>{p.fitReason}</div>
                            </div>
                            <button
                              onClick={() => addPartner(p, group.role)}
                              disabled={partners.some(pr => pr.name.toLowerCase() === p.name.toLowerCase())}
                              style={btn('secondary', partners.some(pr => pr.name.toLowerCase() === p.name.toLowerCase()))}
                            >
                              {partners.some(pr => pr.name.toLowerCase() === p.name.toLowerCase()) ? <><Check size={12} /> Added</> : <><Plus size={12} /> Add</>}
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ ...card, textAlign: 'center', padding: '20px' }}>
                    <div style={{ fontSize: '12px', color: C.muted, marginBottom: '10px' }}>Load AI-suggested partners from the IRIS KB and web</div>
                    <button onClick={fetchConsortium} style={btn('secondary')}>
                      <RefreshCw size={12} /> Search for Suggestions
                    </button>
                  </div>
                )}
            </>
          )}

          {/* ── PHASE 3: DOCUMENT BUILDER ───────────────────────────────────── */}
          {phase === 'write' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(0,196,212,0.15)', border: `1px solid rgba(0,196,212,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PenLine size={18} color={C.cyan} />
                </div>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.white, margin: 0 }}>Document Builder</h1>
                  <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>
                    {brief?.acronym || 'Proposal'} · {brief?.actionType || 'RIA'} Part B
                  </p>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <button onClick={() => setPhase('consortium')} style={{ ...btn('ghost'), fontSize: '12px' }}>
                    <ChevronLeft size={12} /> Consortium
                  </button>
                  <button onClick={() => setPhase('export')} style={{ ...btn('secondary'), fontSize: '12px' }}>
                    Export <ChevronRight size={12} />
                  </button>
                </div>
              </div>

              {/* Section navigator */}
              {template && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {writableSections.map(sec => {
                    const status = getSectionStatus(sec, sections, generatingSection)
                    const isAct  = activeSection === sec.id
                    return (
                      <button
                        key={sec.id}
                        onClick={() => setActiveSection(sec.id)}
                        style={{
                          padding: '5px 10px', borderRadius: '20px', border: `1px solid ${isAct ? C.cyan : C.border}`,
                          background: isAct ? 'rgba(0,196,212,0.12)' : 'transparent',
                          color: isAct ? C.cyan : status === 'complete' ? C.green : status === 'review' ? C.amber : C.muted,
                          fontSize: '11px', fontWeight: isAct ? 700 : 400, fontFamily: 'inherit', cursor: 'pointer',
                        }}
                      >
                        {status === 'complete' ? '✓ ' : status === 'generating' ? '⟳ ' : status === 'review' ? '! ' : ''}
                        {sec.title.replace(/^\d+\.\d+\s+/, '').slice(0, 22)}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Active section editor */}
              {activeSection && (() => {
                const sec = template?.sections.find(s => s.id === activeSection)
                if (!sec) return null
                const words   = wordCount(sections[activeSection] || '')
                const target  = sec.words
                const ratio   = target ? words / target : 0
                const statusCol = ratio >= 0.85 && ratio <= 1.15 ? C.green : ratio < 0.7 ? C.amber : C.red

                return (
                  <div>
                    <div style={card}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: C.white, marginBottom: '4px' }}>{sec.title}</div>
                          <div style={{ fontSize: '11px', color: C.muted }}>
                            Target: {sec.pages} pages · ~{sec.words.toLocaleString()} words
                          </div>
                          <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px' }}>{sec.description}</div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: statusCol }}>
                            {words.toLocaleString()} / {target.toLocaleString()} words
                          </div>
                          <div style={{ fontSize: '10px', color: C.muted }}>
                            ~{Math.round(words / 400 * 10) / 10} pages
                          </div>
                        </div>
                      </div>

                      {/* Brief context summary */}
                      {brief && (
                        <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(0,196,212,0.05)', border: `1px solid rgba(0,196,212,0.12)`, marginBottom: '12px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: C.cyan, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Context injected automatically</div>
                          <div style={{ fontSize: '11px', color: C.muted, lineHeight: 1.6 }}>
                            <div>• Scope: {brief.scopeSelected || brief.callTitle}</div>
                            <div>• Project: {brief.acronym} — {brief.coreInnovation?.slice(0, 80)}...</div>
                            <div>• Technologies: {brief.irisTechnologies.join(', ')}</div>
                            <div>• TRL: {brief.trlStart} → {brief.trlEnd} · Pilots: {brief.pilots.join(', ')}</div>
                          </div>
                        </div>
                      )}

                      {/* Additional context */}
                      <div style={{ marginBottom: '12px' }}>
                        <span style={{ ...label, marginBottom: '6px' }}>Additional Context <span style={{ color: C.muted, fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: '10px' }}>— optional</span></span>
                        <textarea
                          rows={2}
                          value={sectionContexts[activeSection] || ''}
                          onChange={e => setSectionContexts(prev => ({ ...prev, [activeSection]: e.target.value }))}
                          placeholder="Specific requirements or emphasis for this section..."
                          style={{ ...textareaStyle, minHeight: 'unset' }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => generateSection(activeSection)}
                          disabled={generating || (!callText && !callResolved)}
                          style={btn('primary', generating || (!callText && !callResolved))}
                        >
                          {generatingSection === activeSection
                            ? <><Loader2 size={13} className="spin" /> Generating...</>
                            : sections[activeSection] ? <><RefreshCw size={13} /> Regenerate</> : <><PenLine size={13} /> Generate Section</>
                          }
                        </button>
                        {sections[activeSection] && (
                          <button onClick={() => setSections(prev => ({ ...prev, [activeSection]: '' }))} style={btn('ghost')}>
                            <X size={12} /> Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {writeError && (
                      <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.2)`, color: C.red, fontSize: '12px', marginBottom: '12px' }}>
                        {writeError}
                      </div>
                    )}

                    {/* Output textarea */}
                    {(sections[activeSection] || generatingSection === activeSection) && (
                      <div style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          <FileText size={12} color={C.muted} />
                          <span style={{ fontSize: '11px', color: C.muted }}>Generated text — editable inline</span>
                          {generatingSection === activeSection && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: C.cyan, fontWeight: 600, marginLeft: 'auto' }}>
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: C.cyan, display: 'inline-block', animation: 'pulse 1.2s infinite' }} /> streaming
                            </span>
                          )}
                        </div>
                        <textarea
                          value={sections[activeSection] || ''}
                          onChange={e => setSections(prev => ({ ...prev, [activeSection]: e.target.value }))}
                          style={{
                            ...textareaStyle,
                            background: C.bg, minHeight: '360px', lineHeight: 1.8,
                            fontSize: '13.5px', color: '#CBD5E1', resize: 'vertical',
                          }}
                          placeholder={generatingSection === activeSection ? 'Generating...' : ''}
                        />
                      </div>
                    )}

                    {/* References block — rendered below textarea if present */}
                    {sections[activeSection]?.includes('---\n**References**') && (() => {
                      const refText = sections[activeSection].split('---\n**References**')[1]?.trim()
                      if (!refText) return null
                      const lines = refText.split('\n').filter(l => l.trim())
                      return (
                        <div style={{ ...card, borderTop: `1px solid ${C.border}`, borderRadius: '0 0 14px 14px', marginTop: '-14px', paddingTop: '16px' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: C.muted, textTransform: 'uppercase' as const, marginBottom: '10px' }}>References</div>
                          {lines.map((line, i) => {
                            // Split line into text segments and URLs
                            const urlRegex = /(https?:\/\/(?:doi\.org|arxiv\.org|scholar\.google\.com)\/[^\s,)]+)/g
                            const parts: React.ReactNode[] = []
                            let last = 0
                            let m: RegExpExecArray | null
                            const pattern = new RegExp(urlRegex.source, 'g')
                            while ((m = pattern.exec(line)) !== null) {
                              if (m.index > last) parts.push(line.slice(last, m.index))
                              parts.push(
                                <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer"
                                  style={{ color: C.cyan, textDecoration: 'none', wordBreak: 'break-all' as const }}>
                                  {m[0]}
                                </a>
                              )
                              last = m.index + m[0].length
                            }
                            if (last < line.length) parts.push(line.slice(last))
                            return (
                              <div key={i} style={{ fontSize: '11px', color: C.text, marginBottom: '8px', lineHeight: 1.6, paddingLeft: '16px', textIndent: '-16px' }}>
                                {parts}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* Prev / Next navigation */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                      <button
                        onClick={() => activeIdx > 0 && setActiveSection(writableSections[activeIdx - 1].id)}
                        disabled={activeIdx <= 0}
                        style={btn('ghost', activeIdx <= 0)}
                      >
                        <ChevronLeft size={13} /> {activeIdx > 0 ? writableSections[activeIdx - 1].title.replace(/^\d+\.\d+\s+/, '').slice(0, 30) : 'Previous'}
                      </button>
                      {activeIdx < writableSections.length - 1 ? (
                        <button
                          onClick={() => setActiveSection(writableSections[activeIdx + 1].id)}
                          style={btn('ghost')}
                        >
                          {writableSections[activeIdx + 1].title.replace(/^\d+\.\d+\s+/, '').slice(0, 30)} <ChevronRight size={13} />
                        </button>
                      ) : (
                        <button onClick={() => setPhase('export')} style={btn('primary')}>
                          Export <ChevronRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}

              {!activeSection && (
                <div style={{ ...card, textAlign: 'center', padding: '32px', color: C.muted }}>
                  Select a section above or from the outline panel to begin writing
                </div>
              )}
            </>
          )}

          {/* ── PHASE 4: EXPORT ─────────────────────────────────────────────── */}
          {phase === 'export' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(0,196,212,0.15)', border: `1px solid rgba(0,196,212,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileCheck size={18} color={C.cyan} />
                </div>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.white, margin: 0 }}>Export</h1>
                  <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>
                    {completedSections}/{writableSections.length} sections written · ~{estPages} pages
                  </p>
                </div>
                <button onClick={() => setPhase('write')} style={{ ...btn('ghost'), marginLeft: 'auto', fontSize: '12px' }}>
                  <ChevronLeft size={12} /> Back to Document
                </button>
              </div>

              {/* Compliance results */}
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <span style={label}>Compliance Check</span>
                  <button onClick={runCompliance} disabled={complianceLoading} style={{ ...btn('ghost'), fontSize: '11px', padding: '5px 10px' }}>
                    {complianceLoading ? <><Loader2 size={11} className="spin" /> Checking...</> : <><RefreshCw size={11} /> Re-check</>}
                  </button>
                </div>

                {complianceLoading && (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    <Loader2 size={18} color={C.cyan} className="spin" />
                    <div style={{ fontSize: '12px', color: C.muted, marginTop: '8px' }}>Checking against call requirements...</div>
                  </div>
                )}

                {complianceResult && !complianceLoading && (
                  <>
                    {complianceResult.failed.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        {complianceResult.failed.map((f, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(248,113,113,0.07)', border: `1px solid rgba(248,113,113,0.18)`, color: C.red, fontSize: '12px', marginBottom: '6px' }}>
                            <X size={12} style={{ flexShrink: 0, marginTop: '2px' }} /> {f.text}
                          </div>
                        ))}
                      </div>
                    )}
                    {complianceResult.warnings.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        {complianceResult.warnings.map((w, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.07)', border: `1px solid rgba(245,158,11,0.18)`, color: C.amber, fontSize: '12px', marginBottom: '6px' }}>
                            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '2px' }} /> {w.text}
                          </div>
                        ))}
                      </div>
                    )}
                    {complianceResult.passed.length > 0 && (
                      <div>
                        {complianceResult.passed.map((p, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(45,203,122,0.07)', border: `1px solid rgba(45,203,122,0.18)`, color: C.green, fontSize: '12px', marginBottom: '6px' }}>
                            <Check size={12} style={{ flexShrink: 0, marginTop: '2px' }} /> {p.text}
                          </div>
                        ))}
                      </div>
                    )}
                    {!complianceResult.passed.length && !complianceResult.warnings.length && !complianceResult.failed.length && (
                      <div style={{ textAlign: 'center', padding: '16px', fontSize: '12px', color: C.muted }}>No content to check yet — write some sections first</div>
                    )}
                  </>
                )}

                {!complianceResult && !complianceLoading && (
                  <div style={{ textAlign: 'center', padding: '16px', fontSize: '12px', color: C.muted }}>
                    Compliance check will run automatically
                  </div>
                )}
              </div>

              {/* Citations Verification Panel */}
              {Object.keys(sections).length > 0 && (() => {
                const citations = extractCitationsWithTitles(sections)
                if (citations.length === 0) return null
                return (
                  <div style={card}>
                    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.muted, marginBottom: '12px' }}>
                      Citations Found — {citations.length} References
                    </div>
                    {citations.map(({ citation, title, doi }) => (
                      <div key={citation} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '8px 12px', background: C.input, borderRadius: '6px' }}>
                        <span style={{ flex: 1, fontSize: '13px', color: C.text }}>{citation}</span>
                        {doi ? (
                          <a href={doi} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '11px', color: C.cyan, textDecoration: 'none', padding: '3px 8px', border: `1px solid ${C.cyan}`, borderRadius: '4px', whiteSpace: 'nowrap' as const }}>
                            View Paper ↗
                          </a>
                        ) : (
                          <a href={semanticScholarUrl(citation, title)} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '11px', color: C.cyan, textDecoration: 'none', padding: '3px 8px', border: `1px solid ${C.cyan}`, borderRadius: '4px', whiteSpace: 'nowrap' as const }}>
                            Semantic Scholar ↗
                          </a>
                        )}
                        <a href={googleScholarUrl(citation, title)} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '11px', color: C.muted, textDecoration: 'none', padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: '4px', whiteSpace: 'nowrap' as const }}>
                          Google Scholar ↗
                        </a>
                      </div>
                    ))}
                    <div style={{ fontSize: '11px', color: C.amber, marginTop: '8px' }}>
                      ⚠ Verify all citations before submission. Citations marked [To be verified] in the reference lists must be checked.
                    </div>
                  </div>
                )
              })()}

              {/* Export options */}
              <div style={card}>
                <span style={label}>Export</span>
                <div style={{ fontSize: '13px', color: C.muted, marginBottom: '16px' }}>
                  Downloads a Word document (.docx) formatted to HE Part B template — Arial 11pt, 15mm margins, header/footer, page numbers.
                </div>

                {exportError && (
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.2)`, color: C.red, fontSize: '12px', marginBottom: '12px' }}>
                    {exportError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={exportDocx}
                    disabled={exporting || !brief || !template}
                    style={{ ...btn('primary', exporting || !brief || !template), padding: '13px 24px' }}
                  >
                    {exporting
                      ? <><Loader2 size={14} className="spin" /> Generating DOCX...</>
                      : <><Download size={14} /> Download Part B (.docx)</>
                    }
                  </button>
                  <button onClick={() => setPhase('write')} style={btn('ghost')}>
                    <PenLine size={13} /> Continue editing
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </main>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
        textarea::placeholder { color: #475569 !important; }
        input::placeholder { color: #475569 !important; }
        select option { background: #0D3A45; color: white; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}
