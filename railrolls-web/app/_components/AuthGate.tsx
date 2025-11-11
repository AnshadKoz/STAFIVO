'use client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="p-6">Loading...</div>
  if (!authed) return (
    <div className="p-6">
      Not signed in. <Link href="/login" className="underline">Go to login</Link>
    </div>
  )
  return <>{children}</>
}