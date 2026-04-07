import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Mono, Lora, Londrina_Solid, Reenie_Beanie } from 'next/font/google'
import NavBar from '@/components/NavBar'
import '@/styles/globals.css'

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  axes: ['opsz', 'SOFT', 'WONK'],
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
})

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  style: ['normal', 'italic'],
  display: 'swap',
})

const londrinaSolid = Londrina_Solid({
  subsets: ['latin'],
  variable: '--font-londrina',
  weight: ['400'],
  display: 'swap',
})

const reenieBeanie = Reenie_Beanie({
  subsets: ['latin'],
  variable: '--font-reenie',
  weight: ['400'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'The Inflation Ledger',
  description: 'Real prices, real change. Track what everyday goods cost in America.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${ibmPlexMono.variable} ${lora.variable} ${londrinaSolid.variable} ${reenieBeanie.variable}`}
    >
      <body>
        {children}
      </body>
    </html>
  )
}
