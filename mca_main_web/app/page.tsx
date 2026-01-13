import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export default async function Home() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    redirect('/login')
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (appUserError || !appUser) {
    redirect('/login')
  }

  if (appUser.role === 'admin') redirect('/admin')
  if (appUser.role === 'manager') redirect('/manager')
  if (appUser.role === 'worker') redirect('/worker')

  redirect('/login')
}
