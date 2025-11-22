'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const signIn = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)
    if (error) {
      alert(error.message)
      return
    }

    router.push('/')
  }

  return (
    <div className="min-h-screen bg-emerald-50/70 px-4 py-12">
      <div className="mx-auto max-w-md rounded-3xl border border-emerald-100 bg-white/90 p-8 shadow-xl backdrop-blur">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-emerald-600">Rail Rolls</p>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">
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
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 text-gray-900 placeholder-gray-400 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? 'Preparing dashboard…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">Use your company email to sign in.</p>
      </div>
    </div>
  )
}
