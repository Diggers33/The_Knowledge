'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/chat')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0A2E36',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background grid lines */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(#00C4D4 1px, transparent 1px), linear-gradient(90deg, #00C4D4 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
      }} />

      {/* Glow orb top-right */}
      <div style={{
        position: 'absolute', top: '-120px', right: '-120px',
        width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,196,212,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Glow orb bottom-left */}
      <div style={{
        position: 'absolute', bottom: '-100px', left: '-100px',
        width: '350px', height: '350px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(45,203,122,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: '400px',
        margin: '0 24px',
        background: 'rgba(13,58,69,0.8)',
        border: '1px solid rgba(0,196,212,0.15)',
        borderRadius: '20px',
        padding: '44px 40px',
        backdropFilter: 'blur(12px)',
        position: 'relative',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,196,212,0.05)',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img
            src="/iris-logo.png"
            alt="IRIS Technology Solutions"
            style={{ height: '42px', width: 'auto', marginBottom: '20px' }}
          />
          <div style={{ width: '40px', height: '2px', background: 'linear-gradient(90deg, transparent, #00C4D4, transparent)', margin: '0 auto 20px' }} />
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'white', margin: '0 0 4px' }}>
            Knowledge Base
          </h1>
          <p style={{ fontSize: '12px', color: '#475569', margin: 0 }}>
            Internal Research & Intelligence Platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748B', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@iris-eng.com"
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'rgba(19,77,92,0.6)',
                border: '1px solid rgba(0,196,212,0.2)',
                color: 'white',
                fontSize: '14px',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(0,196,212,0.6)'}
              onBlur={e => e.target.style.borderColor = 'rgba(0,196,212,0.2)'}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748B', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'rgba(19,77,92,0.6)',
                border: '1px solid rgba(0,196,212,0.2)',
                color: 'white',
                fontSize: '14px',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(0,196,212,0.6)'}
              onBlur={e => e.target.style.borderColor = 'rgba(0,196,212,0.2)'}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: '16px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)',
              color: '#F87171',
              fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: '10px',
              border: 'none',
              background: loading
                ? 'rgba(0,196,212,0.3)'
                : 'linear-gradient(135deg, #00C4D4, #00A8B8)',
              color: loading ? 'rgba(10,46,54,0.5)' : '#0A2E36',
              fontSize: '14px',
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: loading ? 'default' : 'pointer',
              letterSpacing: '0.02em',
              transition: 'all 0.2s',
              boxShadow: loading ? 'none' : '0 4px 20px rgba(0,196,212,0.25)',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <p style={{ textAlign: 'center', marginTop: '28px', fontSize: '11px', color: '#1A4A57' }}>
          IRIS Technology Solutions · Barcelona
        </p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        input::placeholder { color: #334E5A !important; }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 30px #0D3A45 inset !important;
          -webkit-text-fill-color: white !important;
        }
      `}</style>
    </div>
  )
}
