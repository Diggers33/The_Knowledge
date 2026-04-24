import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'IRIS Knowledge Base',
  description: 'IRIS Technology Solutions — Internal Knowledge Repository',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
