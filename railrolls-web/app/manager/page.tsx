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

  type ManagerRecordRow = {
    id: string
    outlet_id: string | null
    is_active: boolean
    outlet?: { id: string; name: string | null } | null
  }

  const { data: managerRecordRaw } = await supabase
    .from('managers')
    .select('id,outlet_id,is_active,outlet:outlets(id,name)')
    .eq('app_user_id', user.id)
    .maybeSingle()
  const managerRecord = (managerRecordRaw as ManagerRecordRow | null) ?? null

  const { data: outlets } = await supabase.from('outlets').select('id,name').order('name')
  const { data: workers } = await supabase
    .from('workers')
    .select('id,name,phone,email,outlet_id,base_salary_per_hour,ot_rate_per_hour,outlet:outlets(name)')
    .order('name')

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('id, worker_id, outlet_id, action, timestamp_utc')
    .order('timestamp_utc', { ascending: false })
    .limit(20)

  type WorkerRow = {
    id: string
    name: string
    phone: string | null
    email: string | null
    outlet_id: string | null
    base_salary_per_hour: number | null
    ot_rate_per_hour: number | null
    outlet?: { name: string | null } | null
  }

  const safeWorkers =
    (workers as WorkerRow[] | null)?.map(worker => ({
      ...worker,
      outletName: worker.outlet?.name ?? 'Outlet not set',
    })) ?? []
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

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id,type,title,body,data,is_read,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: myRequests } = await supabase
    .from('worker_onboarding_requests')
    .select(
      'id,name,phone,email,base_salary_per_hour,ot_rate_per_hour,outlet_id,status,requested_by,admin_comment,created_at'
    )
    .eq('requested_by', user.id)
    .order('created_at', { ascending: false })

  type AppealRow = {
    id: string
    worker_id: string
    adjustment_id: string
    reason: string
    status: 'pending' | 'approved' | 'rejected'
    created_at: string
    manager_response: string | null
    worker: { id: string; name: string | null } | null
  }

  const { data: managerAppeals } = await supabase
    .from('fine_appeals')
    .select(
      `
        id,
        worker_id,
        adjustment_id,
        reason,
        status,
        created_at,
        manager_response,
        worker:workers (
          id,
          name
        )
      `
    )
    .eq('manager_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  const appealsWithWorkers =
    (managerAppeals as AppealRow[] | null)?.map(appeal => ({
      ...appeal,
      worker_name: appeal.worker?.name ?? null,
    })) ?? []

  const trendStart = new Date()
  trendStart.setDate(trendStart.getDate() - 30)
  const trendStartStr = trendStart.toISOString().slice(0, 10)
  const trendWeekStart = new Date()
  trendWeekStart.setDate(trendWeekStart.getDate() - 6)
  const trendWeekStartStr = trendWeekStart.toISOString().slice(0, 10)

  const { data: workerHoursRows } = await supabase
    .from('worker_daily_hours')
    .select('worker_id,hours_worked')
    .gte('work_date', trendStartStr)

  const { data: workerOtRows } = await supabase
    .from('worker_adjustments')
    .select('worker_id,hours')
    .eq('kind', 'ot')
    .gte('effective_date', trendStartStr)

  const workerHourTotals = new Map<string, number>()
  ;(workerHoursRows ?? []).forEach(row => {
    if (!row.worker_id) return
    workerHourTotals.set(row.worker_id, (workerHourTotals.get(row.worker_id) ?? 0) + (row.hours_worked ?? 0))
  })

  const workerOtTotals = new Map<string, number>()
  ;(workerOtRows ?? []).forEach(row => {
    if (!row.worker_id) return
    workerOtTotals.set(row.worker_id, (workerOtTotals.get(row.worker_id) ?? 0) + (row.hours ?? 0))
  })

  const { data: workerHoursWeekRows } = await supabase
    .from('worker_daily_hours')
    .select('worker_id,hours_worked')
    .gte('work_date', trendWeekStartStr)

  const { data: workerOtWeekRows } = await supabase
    .from('worker_adjustments')
    .select('worker_id,hours')
    .eq('kind', 'ot')
    .gte('effective_date', trendWeekStartStr)

  const workerHourTotalsWeek = new Map<string, number>()
  ;(workerHoursWeekRows ?? []).forEach(row => {
    if (!row.worker_id) return
    workerHourTotalsWeek.set(row.worker_id, (workerHourTotalsWeek.get(row.worker_id) ?? 0) + (row.hours_worked ?? 0))
  })

  const workerOtTotalsWeek = new Map<string, number>()
  ;(workerOtWeekRows ?? []).forEach(row => {
    if (!row.worker_id) return
    workerOtTotalsWeek.set(row.worker_id, (workerOtTotalsWeek.get(row.worker_id) ?? 0) + (row.hours ?? 0))
  })

  const workerAnalytics =
    safeWorkers.map(worker => ({
      worker_id: worker.id,
      worker_name: worker.name,
      total_hours: Number(workerHourTotals.get(worker.id) ?? 0),
      ot_hours: Number(workerOtTotals.get(worker.id) ?? 0),
    })) ?? []

  const workerAnalyticsWeekly =
    safeWorkers.map(worker => ({
      worker_id: worker.id,
      worker_name: worker.name,
      total_hours: Number(workerHourTotalsWeek.get(worker.id) ?? 0),
      ot_hours: Number(workerOtTotalsWeek.get(worker.id) ?? 0),
    })) ?? []

  const profileWithOutlet = profile
    ? { ...profile, outlet_id: profile.outlet_id ?? managerRecord?.outlet_id ?? null }
    : null

  const managerOutlet = managerRecord?.outlet_id
    ? { id: managerRecord.outlet_id, name: managerRecord.outlet?.name ?? null }
    : null

  return (
    <ManagerDashboardClient
      initialProfile={profileWithOutlet ?? null}
      initialOutlets={safeOutlets}
      initialWorkers={safeWorkers}
      initialAttendance={attendance}
      hoursSummary={{ weeklyHours, monthlyHours }}
      userId={user.id}
      workerRequests={myRequests ?? []}
      notifications={notifications ?? []}
      fineAppeals={appealsWithWorkers}
      workerAnalytics={workerAnalytics}
      workerAnalyticsWeekly={workerAnalyticsWeekly}
      managerOutlet={managerOutlet}
    />
  )
}
