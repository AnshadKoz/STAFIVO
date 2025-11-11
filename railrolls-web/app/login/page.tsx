'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const signIn = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) return alert(error.message)
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Brand / Title */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Rail Rolls <span className="text-green-600">Console</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to manage outlets & workers</p>
        </div>

        {/* Card */}
        <form
          onSubmit={signIn}
          className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-4"
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              placeholder="name@company.com"
              autoComplete="off"
              // CHANGED HERE → Added `text-black` so typed text is black, and kept focus border green
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              // CHANGED HERE → Added `text-black` so password input text also stays black
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2.5 text-white font-medium shadow-sm hover:bg-green-700 disabled:opacity-60 transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-500 mt-4">
          By continuing you agree to the company’s usage policy.
        </p>
      </div>
    </div>
  )
}
