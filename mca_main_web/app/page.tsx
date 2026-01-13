import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export default async function Home() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  console.log('[ROOT PAGE] Auth user:', user?.id, user?.email)
  console.log('[ROOT PAGE] Auth error:', userError)

  if (!user || userError) {
    console.log('[ROOT PAGE] No user, redirecting to /login')
    redirect('/login')
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_id', user.id)
    .single()

  console.log('[ROOT PAGE] App user query result:', appUser)
  console.log('[ROOT PAGE] App user error:', appUserError)

  if (appUserError || !appUser) {
    console.log('[ROOT PAGE] No app user found, redirecting to /login')
    redirect('/login')
  }

  console.log('[ROOT PAGE] User role:', appUser.role)
  console.log('[ROOT PAGE] Redirecting to:',
    appUser.role === 'admin' ? '/admin' :
      appUser.role === 'manager' ? '/manager' :
        appUser.role === 'worker' ? '/worker' :
          '/login (no valid role)'
  )

  if (appUser.role === 'admin') redirect('/admin')
  if (appUser.role === 'manager') redirect('/manager')
  if (appUser.role === 'worker') redirect('/worker')

  console.log('[ROOT PAGE] No role matched, redirecting to /login')
  redirect('/login')
}
