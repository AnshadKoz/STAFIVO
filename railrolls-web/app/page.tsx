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

  const { data: appUser, error: roleError } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (roleError || !appUser?.role) {
    redirect('/login')
  }

  switch (appUser.role) {
    case 'admin':
      redirect('/manager')
    case 'manager':
      redirect('/manager')
    case 'worker':
      redirect('/worker')
    default:
      redirect('/login')
  }
}
