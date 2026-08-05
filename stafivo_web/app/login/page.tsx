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
    <div className="relative min-h-screen overflow-hidden bg-blue-50/70 px-4 py-12">
      {/* Background Watermark */}
      <div className="pointer-events-none absolute inset-0 flex w-full items-center justify-center overflow-hidden">
        <h1 className="select-none text-[20vw] font-black uppercase tracking-widest text-blue-950/5">
          STAFIVO
        </h1>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
          <p className="mt-4 animate-pulse text-lg font-medium text-blue-800">
            Preparing dashboard…
          </p>
        </div>
      )}

      <div className="relative mx-auto max-w-md">
        {/* Card */}
        <div className="rounded-3xl border border-blue-100 bg-white/95 p-8 shadow-xl shadow-blue-900/5 backdrop-blur">

          {/* Logo + Brand */}
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="/brand/stafivo-logo.png"
              alt="STAFIVO"
              className="h-20 w-auto object-contain"
            />
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-blue-950">
              STAFIVO <span className="text-blue-600">Console</span>
            </h1>
            <p className="mt-1.5 text-sm text-gray-500">
              Sign in with your company email to continue.
            </p>
          </div>

          <form onSubmit={signIn} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-semibold text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-gray-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 pr-10 text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 focus:outline-none transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-700/25 transition hover:bg-blue-800 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-center text-xs text-gray-400">
            Powered by{' '}
            <span className="font-semibold text-blue-700">Pent 26</span>
          </p>
        </div>
      </div>
    </div>
  )
}
