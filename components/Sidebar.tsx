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

        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
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
  )
}
