import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import LoadingShell from './_components/LoadingShell'
import { ToastProvider } from './_components/ToastProvider'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'Rail Rolls Console',
  description: 'Operations console for the Rail Rolls workforce platform.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ToastProvider>
          <Suspense fallback={<LoadingShell />}>{children}</Suspense>
        </ToastProvider>
      </body>
    </html>
  )
}
