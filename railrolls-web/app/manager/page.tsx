import { redirect } from 'next/navigation'
import ManagerDashboardClient from './ManagerDashboardClient'
import { createClient } from '@/utils/supabase/server'

const toDateOnly = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export default async function ManagerPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, role, outlet_id, name')
    .eq('id', user.id)
    .single()

  const { data: outlets } = await supabase.from('outlets').select('id,name').order('name')
  const { data: workers } = await supabase
    .from('workers')
    .select('id,name,phone,email,outlet_id,base_salary_per_hour,ot_rate_per_hour')
    .order('name')

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('id, worker_id, outlet_id, action, timestamp_utc')
    .order('timestamp_utc', { ascending: false })
    .limit(20)

  const safeWorkers = workers ?? []
  const safeOutlets = outlets ?? []
  type AttendanceLogRow = {
    id: string
    worker_id: string
    outlet_id: string
    action: 'IN' | 'OUT'
    timestamp_utc: string
  }

  const attendance = (logs ?? []).map((log: AttendanceLogRow) => ({
    ...log,
    worker_name: safeWorkers.find((w: typeof safeWorkers[number]) => w.id === log.worker_id)?.name || '-',
    outlet_name: safeOutlets.find((o: typeof safeOutlets[number]) => o.id === log.outlet_id)?.name || '-',
  }))

  const today = toDateOnly()
  const weekStart = new Date(today)
  const day = weekStart.getUTCDay()
  const diff = (day + 6) % 7
  weekStart.setUTCDate(weekStart.getUTCDate() - diff)
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const monthStartStr = monthStart.toISOString().slice(0, 10)
  const todayStr = today.toISOString().slice(0, 10)

  const { data: weeklyRows } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .gte('work_date', weekStartStr)
    .lte('work_date', todayStr)

  const { data: monthlyRows } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .gte('work_date', monthStartStr)
    .lte('work_date', todayStr)

  const weeklyHours =
    (weeklyRows ?? []).reduce(
      (sum: number, row: { hours_worked: number | null }) => sum + (row.hours_worked ?? 0),
      0
    )
  const monthlyHours =
    (monthlyRows ?? []).reduce(
      (sum: number, row: { hours_worked: number | null }) => sum + (row.hours_worked ?? 0),
      0
    )

  return (
    <ManagerDashboardClient
      initialProfile={profile ?? null}
      initialOutlets={safeOutlets}
      initialWorkers={safeWorkers}
      initialAttendance={attendance}
      hoursSummary={{ weeklyHours, monthlyHours }}
      userId={user.id}
    />
  )
}
