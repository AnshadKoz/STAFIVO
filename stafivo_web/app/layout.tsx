import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import LoadingShell from './_components/LoadingShell'
import { ToastProvider } from '@/app/_components/ToastProvider'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://app.stafivo.com'),
  title: 'STAFIVO Console',
  description: 'Admin & operations console for the STAFIVO workforce management platform. Built by Pent 26.',
  icons: {
    icon: [
      { url: '/brand/logo-icon.svg', type: 'image/svg+xml' },
      { url: '/brand/stafivo-logo.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
    shortcut: '/brand/logo-icon.svg',
  },
  openGraph: {
    title: 'STAFIVO Console',
    description: 'Workforce management platform by Pent 26',
    images: [{ url: '/brand/stafivo-logo.png', width: 1024, height: 1024 }],
  },
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <ToastProvider>
          <Suspense fallback={<LoadingShell />}>{children}</Suspense>
        </ToastProvider>
      </body>
    </html>
  )
}
