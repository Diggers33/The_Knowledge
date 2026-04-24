'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MessageSquare, FileOutput, BookOpen, LogOut, Database, PenLine, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/chat',        icon: MessageSquare, label: 'Chat' },
  { href: '/generate',    icon: FileOutput,    label: 'Generate' },
  { href: '/proposal',    icon: PenLine,       label: 'Proposals' },
  { href: '/deliverable', icon: FileText,      label: 'Deliverables' },
  { href: '/library',     icon: BookOpen,      label: 'Library' },
]

const adminItems = [
  { href: '/admin', icon: Database, label: 'Ingestion' },
]

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside style={{
      width: '220px',
      minWidth: '220px',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 10,
      background: '#080C20',
      borderRight: '1px solid #1E2B6A',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{
        padding: '18px 16px',
        borderBottom: '1px solid #1E2B6A',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        {/* K logo mark */}
        <div style={{ width: '32px', height: '32px', flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <defs>
              <linearGradient id="kg1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#5CE1FF" />
                <stop offset="100%" stopColor="#2563EB" />
              </linearGradient>
              <linearGradient id="kg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2563EB" />
                <stop offset="100%" stopColor="#7B5CF5" />
              </linearGradient>
            </defs>
            {/* Vertical spine */}
            <rect x="18" y="15" width="14" height="70" rx="4" fill="url(#kg1)" />
            {/* Top arm */}
            <rect x="30" y="15" width="46" height="28" rx="6"
              transform="rotate(0 30 15)" fill="url(#kg1)" />
            {/* Bottom arm */}
            <rect x="32" y="52" width="42" height="26" rx="6"
              transform="rotate(0 32 52)" fill="url(#kg2)" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#E8EEFF', lineHeight: 1.2 }}>The Knowledge</div>
          <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7B5CF5' }}>Knowledge Repository</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', minHeight: 0 }}>
        <div style={{
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: '#4A5590',
          padding: '8px 10px 6px',
        }}>
          Workspace
        </div>

        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '7px',
              fontSize: '13px', fontWeight: active ? 600 : 400,
              color: active ? '#E8EEFF' : '#8A96C4',
              background: active ? 'rgba(74,158,255,0.1)' : 'transparent',
              textDecoration: 'none', marginBottom: '2px',
              transition: 'all 0.12s',
              borderLeft: `2px solid ${active ? '#4A9EFF' : 'transparent'}`,
            }}>
              <Icon size={15} style={{ color: active ? '#4A9EFF' : '#4A5590', flexShrink: 0 }} />
              {label}
            </Link>
          )
        })}

        {role === 'manager' && (
          <>
            <div style={{ margin: '10px 10px 6px', borderTop: '1px solid #1E2B6A' }} />
            <div style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: '#4A5590',
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
                  color: active ? '#E8EEFF' : '#8A96C4',
                  background: active ? 'rgba(123,92,245,0.1)' : 'transparent',
                  textDecoration: 'none', marginBottom: '2px',
                  transition: 'all 0.12s',
                  borderLeft: `2px solid ${active ? '#7B5CF5' : 'transparent'}`,
                }}>
                  <Icon size={15} style={{ color: active ? '#7B5CF5' : '#4A5590', flexShrink: 0 }} />
                  {label}
                </Link>
              )
            })}
          </>
        )}
      </nav>

      {/* Sign Out */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid #1E2B6A', flexShrink: 0 }}>
        <button onClick={handleLogout} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 10px', borderRadius: '7px', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: '#4A5590',
          transition: 'color 0.12s',
        }}>
          <LogOut size={15} style={{ flexShrink: 0 }} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
