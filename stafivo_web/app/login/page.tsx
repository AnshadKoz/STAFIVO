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
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-12"
      style={{ background: 'linear-gradient(135deg, #0F3D91 0%, #0a2d6e 100%)' }}>

      {/* Dot-grid texture */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-[#1E63FF]/40 blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 h-[400px] w-[400px] rounded-full bg-[#0E9C8F]/30 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[300px] rounded-full bg-[#4DA3FF]/20 blur-[90px]" />
      </div>


      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="mt-4 animate-pulse text-lg font-medium text-blue-800">
            Preparing dashboard…
          </p>
        </div>
      )}

      {/* Card */}
      <div className="relative z-10 w-full max-w-md">

        {/* Logo + Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src="/brand/stafivo-logo.png"
            alt="STAFIVO"
            className="h-20 w-auto object-contain rounded-2xl"
          />
          <h1 className="mt-4 text-2xl font-black tracking-tight">
            <span className="text-white">STAFIVO</span> <span className="text-blue-100">Console</span>
          </h1>
          <p className="mt-1.5 text-sm text-blue-200/70">
            Sign in with your email to continue.
          </p>
        </div>

        {/* Form surface */}
        <div className="rounded-2xl border border-white/10 bg-white px-8 py-8 shadow-[0_20px_60px_0_rgba(0,0,0,0.35)]">
          <form onSubmit={signIn} className="space-y-5">

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-semibold text-[#0F172A]">
                Email address
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-4 py-3 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all focus:border-[#1E63FF] focus:bg-white focus:ring-2 focus:ring-[#1E63FF]/15"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-semibold text-[#0F172A]">
                Password
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-11 py-3 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all focus:border-[#1E63FF] focus:bg-white focus:ring-2 focus:ring-[#1E63FF]/15"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] transition-colors hover:text-[#1E63FF] focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full rounded-xl bg-[#0F3D91] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#0F3D91]/25 transition-all hover:bg-[#0a2d6e] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating…
                </span>
              ) : (
                'Sign in to Dashboard'
              )}
            </button>
          </form>

          {/* Stat pills */}
          <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-full bg-[#EFF6FF] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1E63FF]" />
              <span className="text-xs font-medium text-[#0F3D91]">1,247 Active Staff</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-[#F0FDF4] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
              <span className="text-xs font-medium text-[#15803D]">98.3% Attendance</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-[#F5F3FF] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6]" />
              <span className="text-xs font-medium text-[#6D28D9]">342 Tasks Done</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-blue-200/60">
          Powered by <span className="font-semibold text-white">Pent 26</span>
        </p>
      </div>
    </div>
  )
}
