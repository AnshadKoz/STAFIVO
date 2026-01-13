'use client'
import { useState } from 'react'
import { useToast } from '@/app/_components/ToastProvider'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()

  const signIn = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      showToast({
        type: 'error',
        title: 'Login failed',
        description: error.message,
      })
      return
    }

    // Loading stays true while redirecting to prevent flicker
    router.push('/')
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-emerald-50/70 px-4 py-12">
      {/* Background Watermark */}
      <div className="pointer-events-none absolute inset-0 flex w-full items-center justify-center overflow-hidden">
        <div className="flex flex-1 justify-end pr-4 md:pr-0">
          <h1 className="select-none text-6xl font-black uppercase text-emerald-950/10 sm:text-8xl md:text-9xl lg:text-[10rem] xl:text-[11rem]">
            Work
          </h1>
        </div>

        {/* Spacer strictly reserving space for the login card (max-w-md + margin) */}
        <div className="h-1 w-[28rem] shrink-0 md:w-[32rem]" />

        <div className="flex flex-1 justify-start pl-4 md:pl-0">
          <h1 className="select-none text-6xl font-black uppercase text-emerald-950/10 sm:text-8xl md:text-9xl lg:text-[10rem] xl:text-[11rem]">
            Forge
          </h1>
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"></div>
          <p className="mt-4 animate-pulse text-lg font-medium text-emerald-800">
            Preparing dashboard...
          </p>
        </div>
      )}

      <div className="mx-auto max-w-md rounded-3xl border border-emerald-100 bg-white/90 p-8 shadow-xl backdrop-blur">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/workforge-logo.png" alt="WorkForge" className="h-20 w-auto object-contain" />
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            <span className="text-emerald-600">Console</span> Access
          </h1>
          <p className="mt-2 text-sm text-gray-500">Use your company email to sign in.</p>
        </div>

        <form onSubmit={signIn} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-700">Email</label>
            <input
              type="email"
              placeholder="name@company.com"
              autoComplete="off"
              className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 text-gray-900 placeholder-gray-400 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-700">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 pr-10 text-gray-900 placeholder-gray-400 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? 'Verifying credentials...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">Use your company email to sign in.</p>
      </div>
    </div>
  )
}
