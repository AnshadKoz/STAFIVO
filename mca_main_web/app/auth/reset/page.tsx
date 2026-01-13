'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // Exchange the recovery code in the URL for a session
  useEffect(() => {
    (async () => {
      // handles both hash (#) and query (?) styles
      await supabase.auth.exchangeCodeForSession(window.location.href).catch(() => {})
      setReady(true)
    })()
  }, [])

  const updatePassword = async () => {
    if (!password || password !== confirm) return alert('Passwords do not match')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return alert(error.message)
    alert('Password updated. Signing you in...')
    router.replace('/dashboard')
  }

  if (!ready) return <div className="p-6">Verifying reset link...</div>

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col gap-3 border p-6 rounded-md w-full max-w-sm">
        <h1 className="text-xl font-bold">Set a new password</h1>
        <input
          type="password"
          placeholder="New password"
          className="border p-2 rounded"
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder="Confirm password"
          className="border p-2 rounded"
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        <button onClick={updatePassword} className="bg-black text-white p-2 rounded">
          Update password
        </button>
      </div>
    </div>
  )
}