import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LD Tennis | Professional Coaching',
  description: 'Professional tennis coaching with LD Tennis. Book a session today.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
