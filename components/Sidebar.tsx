'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MessageSquare, FileOutput, BookOpen, LogOut, Database, PenLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/chat',     icon: MessageSquare, label: 'Chat' },
  { href: '/generate', icon: FileOutput,    label: 'Generate' },
  { href: '/proposal', icon: PenLine,       label: 'Proposals' },
  { href: '/library',  icon: BookOpen,      label: 'Library' },
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
      background: '#0D1829',
      borderRight: '1px solid #1A2840',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Logo — keep brand saturation here */}
      <div style={{
        padding: '18px 16px',
        borderBottom: '1px solid #1A2840',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '8px',
          background: 'linear-gradient(135deg, #22D3EE 0%, #0891B2 100%)',
          boxShadow: '0 0 16px rgba(34,211,238,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" fill="#0B1220" />
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#0B1220" opacity="0.5" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#E6EDF7', lineHeight: 1.2 }}>IRIS Knowledge</div>
          <div style={{ fontSize: '10px', color: '#8A9AB3' }}>Technology Solutions</div>
        </div>
      </div>

      {/* Nav — scrollable */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', minHeight: 0 }}>
        <div style={{
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: '#4A5F7A',
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
              color: active ? '#E6EDF7' : '#8A9AB3',
              background: active ? '#162235' : 'transparent',
              textDecoration: 'none', marginBottom: '2px',
              transition: 'all 0.12s',
              borderLeft: `2px solid ${active ? '#22D3EE' : 'transparent'}`,
              position: 'relative',
            }}>
              <Icon size={15} style={{ color: active ? '#22D3EE' : '#4A5F7A', flexShrink: 0 }} />
              {label}
            </Link>
          )
        })}

        {role === 'manager' && (
          <>
            <div style={{ margin: '10px 10px 6px', borderTop: '1px solid #1A2840' }} />
            <div style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: '#4A5F7A',
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
                  color: active ? '#E6EDF7' : '#8A9AB3',
                  background: active ? '#162235' : 'transparent',
                  textDecoration: 'none', marginBottom: '2px',
                  transition: 'all 0.12s',
                  borderLeft: `2px solid ${active ? '#2DCB7A' : 'transparent'}`,
                }}>
                  <Icon size={15} style={{ color: active ? '#2DCB7A' : '#4A5F7A', flexShrink: 0 }} />
                  {label}
                </Link>
              )
            })}
          </>
        )}
      </nav>

      {/* Sign Out — always pinned at bottom */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid #1A2840', flexShrink: 0 }}>
        <button onClick={handleLogout} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 10px', borderRadius: '7px', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: '#4A5F7A',
          transition: 'color 0.12s',
        }}>
          <LogOut size={15} style={{ flexShrink: 0 }} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
