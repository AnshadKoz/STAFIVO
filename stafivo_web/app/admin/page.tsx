import { redirect } from 'next/navigation'
import ManagerDashboardClient from '../manager/ManagerDashboardClient'
import { createClient } from '@/utils/supabase/server'
import AdminPayrollPanels from './AdminPayrollPanels'

const toDateOnly = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

type AttendanceLogRow = {
  id: string
  worker_id: string
  outlet_id: string
  action: 'IN' | 'OUT'
  timestamp_utc: string
  source?: string | null
}

export default async function AdminPage() {
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
    .eq('auth_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  if (profile.role !== 'admin') {
    redirect('/')
  }

  const { data: outlets } = await supabase
    .from('outlets')
    .select('id,name,latitude,longitude,radius_meters')
    .order('name')

  const { data: workers } = await supabase
    .from('workers')
    .select('id,name,phone,email,outlet_id,base_salary_per_hour,ot_rate_per_hour')
    .order('name')

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('id, worker_id, outlet_id, action, timestamp_utc, source')
    .order('timestamp_utc', { ascending: false })
    .limit(100)

  const safeWorkers = workers ?? []
  const safeOutlets = outlets ?? []

  const attendance = (logs ?? []).map((log: AttendanceLogRow) => ({
    ...log,
    worker_name: safeWorkers.find(w => w.id === log.worker_id)?.name || '-',
    outlet_name: safeOutlets.find(o => o.id === log.outlet_id)?.name || '-',
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

  const { data: managerRows } = await supabase.from('managers').select('id,app_user_id,outlet_id,is_active')

  const managerUserIds = (managerRows ?? []).map(row => row.app_user_id)
  const { data: managerUsers } = managerUserIds.length
    ? await supabase
      .from('app_users')
      .select('id,name,email')
      .in('id', managerUserIds)
    : { data: [] }

  const managerUserMap = new Map<string, { name: string | null; email: string | null }>()
  managerUsers?.forEach(row => managerUserMap.set(row.id, { name: row.name, email: row.email }))

  const adminManagers =
    managerRows?.map(row => ({
      id: row.id,
      app_user_id: row.app_user_id,
      outlet_id: row.outlet_id,
      is_active: row.is_active,
      name: managerUserMap.get(row.app_user_id)?.name ?? null,
      email: managerUserMap.get(row.app_user_id)?.email ?? null,
    })) ?? []

  const { data: managerCandidates } = await supabase
    .from('app_users')
    .select('id,name,email')
    .eq('role', 'manager')
    .order('name', { ascending: true })

  const { data: pendingRequests } = await supabase
    .from('worker_onboarding_requests')
    .select(
      'id,name,phone,email,base_salary_per_hour,ot_rate_per_hour,outlet_id,status,requested_by,admin_comment,created_at'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const trendStart = new Date()
  trendStart.setDate(trendStart.getDate() - 30)
  const trendStartStr = trendStart.toISOString().slice(0, 10)

  const { data: hourRows } = await supabase
    .from('worker_daily_hours')
    .select('worker_id,hours_worked')
    .gte('work_date', trendStartStr)

  const { data: otRows } = await supabase
    .from('worker_adjustments')
    .select('worker_id,hours,outlet_id')
    .eq('kind', 'ot')
    .gte('effective_date', trendStartStr)

  const workerOutletMap = new Map<string, string | null>()
  safeWorkers.forEach(worker => workerOutletMap.set(worker.id, worker.outlet_id))

  const hourTotals = new Map<string, number>()
    ; (hourRows ?? []).forEach(row => {
      const outletId = workerOutletMap.get(row.worker_id ?? '')
      if (!outletId) return
      hourTotals.set(outletId, (hourTotals.get(outletId) ?? 0) + (row.hours_worked ?? 0))
    })

  const otTotals = new Map<string, number>()
    ; (otRows ?? []).forEach(row => {
      const outletId = row.outlet_id ?? workerOutletMap.get(row.worker_id ?? '') ?? null
      if (!outletId) return
      otTotals.set(outletId, (otTotals.get(outletId) ?? 0) + (row.hours ?? 0))
    })

  const outletAnalytics =
    safeOutlets.map(outlet => ({
      outlet_id: outlet.id,
      outlet_name: outlet.name ?? 'Outlet',
      total_hours: Number(hourTotals.get(outlet.id) ?? 0),
      total_ot_hours: Number(otTotals.get(outlet.id) ?? 0),
    })) ?? []

  return (
    <ManagerDashboardClient
      initialProfile={profile}
      initialOutlets={safeOutlets}
      initialWorkers={safeWorkers}
      initialAttendance={attendance}
      hoursSummary={{ weeklyHours, monthlyHours }}
      userId={user.id}
      dashboardTitle="STAFIVO · Admin Dashboard"
      workerRequests={pendingRequests ?? []}
      adminManagerRows={adminManagers}
      managerCandidates={managerCandidates ?? []}
      outletAnalytics={outletAnalytics}
      adminPayrollPanel={<AdminPayrollPanels workers={safeWorkers} outlets={safeOutlets} />}
    />
  )
}
