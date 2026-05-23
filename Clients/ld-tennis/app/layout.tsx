import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LD Tennis | Professional Coaching',
  description: 'Professional tennis coaching with LD Tennis. Book a session today.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","wvg8wbtam8");`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
