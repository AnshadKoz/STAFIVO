import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import WorkerDashboardClient from './WorkerDashboardClient'

type DailyRow = { work_date: string; hours_worked: number | null }
type AdjustmentRow = {
  id: string
  effective_date: string
  kind: 'ot' | 'fine' | 'incentive' | 'deduction'
  hours: number | null
  amount: number | null
  note: string | null
}

const getDateBoundaries = () => {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekStart = new Date(today)
  const day = weekStart.getUTCDay()
  const diff = (day + 6) % 7
  weekStart.setUTCDate(weekStart.getUTCDate() - diff)
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  return {
    todayStr: today.toISOString().slice(0, 10),
    weekStartStr: weekStart.toISOString().slice(0, 10),
    monthStartStr: monthStart.toISOString().slice(0, 10),
  }
}

export default async function WorkerPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    redirect('/login')
  }

  const { data: appUser } = await supabase.from('app_users').select('role').eq('auth_id', user.id).single()
  if (!appUser || appUser.role !== 'worker') {
    redirect('/')
  }

  const { data: workerRow, error: workerError } = await supabase
    .from('workers')
    .select('id, name, base_salary_per_hour, ot_rate_per_hour, outlet_id, outlets(name)')
    .eq('auth_id', user.id)
    .single()

  if (workerError || !workerRow) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-red-700">
          No worker profile linked to this account.
        </div>
      </div>
    )
  }

  const { todayStr, weekStartStr, monthStartStr } = getDateBoundaries()

  const { data: weeklyRows } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .eq('worker_id', workerRow.id)
    .gte('work_date', weekStartStr)
    .lte('work_date', todayStr)

  const { data: monthlyRows } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .eq('worker_id', workerRow.id)
    .gte('work_date', monthStartStr)
    .lte('work_date', todayStr)

  const { data: dailyRows } = await supabase
    .from('worker_daily_hours')
    .select('work_date, hours_worked')
    .eq('worker_id', workerRow.id)
    .order('work_date', { ascending: false })
    .limit(30)

  const { data: adjustments } = await supabase
    .from('worker_adjustments')
    .select('id,effective_date, kind, hours, amount, note, fine_appeals(id, status)')
    .eq('worker_id', workerRow.id)
    .order('effective_date', { ascending: false })
    .limit(30)

  const { data: documents } = await supabase
    .from('worker_documents')
    .select('id,kind,storage_path,original_name,created_at')
    .eq('worker_id', workerRow.id)
    .order('created_at', { ascending: false })

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
    <WorkerDashboardClient
      worker={{
        ...workerRow,
        outlets: Array.isArray(workerRow.outlets) ? workerRow.outlets[0] : workerRow.outlets
      }}
      weeklyHours={weeklyHours}
      monthlyHours={monthlyHours}
      dailyRows={(dailyRows as DailyRow[]) ?? []}
      adjustments={(adjustments as AdjustmentRow[]) ?? []}
      documents={documents ?? []}
      authUserId={user.id}
    />
  )
}
