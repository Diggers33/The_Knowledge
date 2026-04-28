'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MessageSquare, FileOutput, BookOpen, LogOut, Database, PenLine, FileText, Scale, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const PROPOSAL_PASSCODE = 'Montseny49'
const SESSION_KEY = 'iris_proposal_unlocked'

const navItems = [
  { href: '/chat',        icon: MessageSquare, label: 'Chat',          locked: false },
  { href: '/generate',    icon: FileOutput,    label: 'Generate',      locked: false },
  { href: '/proposal',    icon: PenLine,       label: 'Proposals',     locked: true  },
  { href: '/deliverable', icon: FileText,      label: 'Deliverables',  locked: false },
  { href: '/evaluate',    icon: Scale,         label: 'Evaluate',      locked: false },
  { href: '/library',     icon: BookOpen,      label: 'Library',       locked: false },
]

const adminItems = [
  { href: '/admin', icon: Database, label: 'Ingestion' },
]

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const [showModal, setShowModal] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(SESSION_KEY) === '1')
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleProposalClick(e: React.MouseEvent) {
    if (unlocked) return // already unlocked — let Link navigate normally
    e.preventDefault()
    setCode('')
    setError('')
    setShowModal(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code === PROPOSAL_PASSCODE) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setUnlocked(true)
      setShowModal(false)
      router.push('/proposal')
    } else {
      setError('Incorrect code')
      setCode('')
    }
  }

  return (
    <>
      <aside style={{
        width: '220px',
        minWidth: '220px',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 10,
        background: '#FFFFFF',
        borderRight: '1px solid #D0D8EE',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Logo */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid #D0D8EE',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <img
            src="/theknowledge.png"
            alt="The Knowledge"
            style={{ width: '160px', height: 'auto', objectFit: 'contain' }}
          />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', minHeight: 0 }}>
          <div style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: '#9AA5C4',
            padding: '8px 10px 6px',
          }}>
            Workspace
          </div>

          {navItems.map(({ href, icon: Icon, label, locked }) => {
            const active = pathname.startsWith(href)
            const isLocked = locked && !unlocked

            if (locked) {
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={handleProposalClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 10px', borderRadius: '7px',
                    fontSize: '13px', fontWeight: active ? 600 : 400,
                    color: active ? '#0F1B3D' : '#5A6A9A',
                    background: active ? 'rgba(74,158,255,0.08)' : 'transparent',
                    textDecoration: 'none', marginBottom: '2px',
                    transition: 'all 0.12s',
                    borderLeft: `2px solid ${active ? '#4A9EFF' : 'transparent'}`,
                  }}
                >
                  <Icon size={15} style={{ color: active ? '#4A9EFF' : '#9AA5C4', flexShrink: 0 }} />
                  {label}
                  {isLocked && (
                    <Lock size={11} style={{ marginLeft: 'auto', color: '#C4CCDF', flexShrink: 0 }} />
                  )}
                </Link>
              )
            }

            return (
              <Link key={href} href={href} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderRadius: '7px',
                fontSize: '13px', fontWeight: active ? 600 : 400,
                color: active ? '#0F1B3D' : '#5A6A9A',
                background: active ? 'rgba(74,158,255,0.08)' : 'transparent',
                textDecoration: 'none', marginBottom: '2px',
                transition: 'all 0.12s',
                borderLeft: `2px solid ${active ? '#4A9EFF' : 'transparent'}`,
              }}>
                <Icon size={15} style={{ color: active ? '#4A9EFF' : '#9AA5C4', flexShrink: 0 }} />
                {label}
              </Link>
            )
          })}

          {role === 'manager' && (
            <>
              <div style={{ margin: '10px 10px 6px', borderTop: '1px solid #D0D8EE' }} />
              <div style={{
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: '#9AA5C4',
                padding: '0 10px 6px',
              }}>
                Admin
              </div>
              {adminItems.map(({ href, icon: Icon, label }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link key={href} href={href} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 10px', borderRadius: '7px',
                    fontSize: '13px', fontWeight: active ? 600 : 400,
                    color: active ? '#0F1B3D' : '#5A6A9A',
                    background: active ? 'rgba(123,92,245,0.08)' : 'transparent',
                    textDecoration: 'none', marginBottom: '2px',
                    transition: 'all 0.12s',
                    borderLeft: `2px solid ${active ? '#7B5CF5' : 'transparent'}`,
                  }}>
                    <Icon size={15} style={{ color: active ? '#7B5CF5' : '#9AA5C4', flexShrink: 0 }} />
                    {label}
                  </Link>
                )
              })}
            </>
          )}
        </nav>

        {/* Sign Out */}
        <div style={{ padding: '10px 8px', borderTop: '1px solid #D0D8EE', flexShrink: 0 }}>
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 10px', borderRadius: '7px', width: '100%',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#9AA5C4',
            transition: 'color 0.12s',
          }}>
            <LogOut size={15} style={{ flexShrink: 0 }} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Passcode modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(10,46,54,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#FFFFFF',
              borderRadius: '16px',
              padding: '36px 32px',
              width: '320px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
              border: '1px solid #D0D8EE',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px',
                background: 'rgba(74,158,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Lock size={20} style={{ color: '#4A9EFF' }} />
              </div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0F1B3D', margin: '0 0 6px' }}>
                Proposals
              </h2>
              <p style={{ fontSize: '13px', color: '#5A6A9A', margin: 0 }}>
                Enter the access code to continue
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <input
                autoFocus
                type="password"
                value={code}
                onChange={e => { setCode(e.target.value); setError('') }}
                placeholder="Access code"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: '9px',
                  border: `1px solid ${error ? '#DC2626' : '#D0D8EE'}`,
                  fontSize: '14px',
                  color: '#0F1B3D',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  marginBottom: error ? '6px' : '16px',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { if (!error) e.target.style.borderColor = '#4A9EFF' }}
                onBlur={e => { if (!error) e.target.style.borderColor = '#D0D8EE' }}
              />
              {error && (
                <p style={{ fontSize: '12px', color: '#DC2626', margin: '0 0 16px 2px' }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '9px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #4A9EFF, #3B82F6)',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  letterSpacing: '0.01em',
                }}
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
