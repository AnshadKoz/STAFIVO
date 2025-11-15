import { createClient } from '@/utils/supabase/server'

export default async function DebugPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: appUser } = await supabase
    .from('app_users')
    .select('id, email, role')
    .eq('id', user?.id ?? '')
    .single()

  return (
    <pre className="p-4 text-xs">
      {JSON.stringify({ user, appUser }, null, 2)}
    </pre>
  )
}
