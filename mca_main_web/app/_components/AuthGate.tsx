'use client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    let mounted = true

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (mounted) {
        setAuthed(!!session)
        setLoading(false)
      }
    }

    checkSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) {
        setAuthed(!!session)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) return <div className="p-6">Loading...</div>
  if (!authed) return (
    <div className="p-6">
      Not signed in. <Link href="/login" className="underline">Go to login</Link>
    </div>
  )
  return <>{children}</>
}