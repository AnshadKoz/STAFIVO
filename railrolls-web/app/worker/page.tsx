import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

type DailyRow = { work_date: string; hours_worked: number | null }
type WorkerRow = {
  id: string
  name: string
  base_salary_per_hour: number | null
  ot_rate_per_hour: number | null
}
type AdjustmentRow = {
  effective_date: string
  kind: 'ot' | 'fine' | 'incentive' | 'deduction'
  hours: number | null
  amount: number | null
  note: string | null
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

const formatHours = (value: number | null | undefined) =>
  typeof value === 'number' ? `${value.toFixed(1)} hrs` : '—'

const formatAmount = (value: number | null | undefined) =>
  typeof value === 'number' ? `₹${value.toFixed(2)}` : '—'

const formatRate = (value: number | null | undefined) =>
  typeof value === 'number' ? `₹${value.toFixed(2)}/hr` : 'Not set'

const KIND_LABELS: Record<AdjustmentRow['kind'], string> = {
  ot: 'OT',
  fine: 'Fine',
  incentive: 'Incentive',
  deduction: 'Deduction',
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

  const { data: appUser } = await supabase.from('app_users').select('role').eq('id', user.id).single()
  if (!appUser || appUser.role !== 'worker') {
    redirect('/')
  }

  const { data: workerRow, error: workerError } = await supabase
    .from('workers')
    .select('id, name, base_salary_per_hour, ot_rate_per_hour')
    .eq('auth_id', user.id)
    .single<WorkerRow>()

  if (workerError || !workerRow) {
    console.error('Missing worker profile', workerError?.message)
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-red-700">
          No worker profile linked to this account.
        </div>
      </div>
    )
  }

  const { todayStr, weekStartStr, monthStartStr } = getDateBoundaries()

  const { data: weeklyRows, error: weeklyError } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .eq('worker_id', workerRow.id)
    .gte('work_date', weekStartStr)
    .lte('work_date', todayStr)

  const { data: monthlyRows, error: monthlyError } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked')
    .eq('worker_id', workerRow.id)
    .gte('work_date', monthStartStr)
    .lte('work_date', todayStr)

  const { data: dailyRows, error: dailyError } = await supabase
    .from('worker_daily_hours')
    .select('work_date, hours_worked')
    .eq('worker_id', workerRow.id)
    .order('work_date', { ascending: false })
    .limit(30)

  const { data: adjustments, error: adjustmentsError } = await supabase
    .from('worker_adjustments')
    .select('effective_date, kind, hours, amount, note')
    .eq('worker_id', workerRow.id)
    .order('effective_date', { ascending: false })
    .limit(50)

  const hasError = weeklyError || monthlyError || dailyError || adjustmentsError
  if (hasError) {
    console.error('Worker dashboard query error', {
      weeklyError,
      monthlyError,
      dailyError,
      adjustmentsError,
    })
  }

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

  const safeDailyRows: DailyRow[] = dailyRows ?? []
  const safeAdjustments: AdjustmentRow[] = adjustments ?? []

  return (
    <div className="min-h-screen bg-white px-4 py-10 text-gray-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <p className="text-sm font-medium text-green-600">Worker area</p>
          <h1 className="mt-1 text-3xl font-bold">Worker Dashboard</h1>
          <p className="text-gray-600">
            Hi, {workerRow.name?.trim() ? workerRow.name : 'there'}
          </p>
        </header>

        {hasError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            Could not load some data. Please try again.
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-semibold">My Pay Rates</h2>
            <p className="text-sm text-gray-500">These rates are set by your manager/admin.</p>
          </div>
          <div className="px-5 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-sm text-gray-500">Base rate</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">
                  {formatRate(workerRow.base_salary_per_hour)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500">OT rate</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">
                  {formatRate(workerRow.ot_rate_per_hour)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-semibold">My Hours Summary</h2>
          </div>
          <div className="px-5 py-5">
            <div className="flex flex-col gap-6 md:flex-row md:gap-12">
              <div>
                <div className="text-sm text-gray-500">This week</div>
                <div className="text-3xl font-bold">{weeklyHours.toFixed(1)} hrs</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">This month</div>
                <div className="text-3xl font-bold">
                  {monthlyHours.toFixed(1)} hrs
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-semibold">My Daily Hours</h2>
            <p className="text-sm text-gray-500">Last 30 entries</p>
          </div>

          <div className="px-5 py-5">
            {safeDailyRows.length === 0 ? (
              <p className="text-sm text-gray-500">No hours tracked yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Hours worked
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {safeDailyRows.map(row => (
                      <tr key={row.work_date} className="even:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{formatDate(row.work_date)}</td>
                        <td className="px-4 py-2 text-sm">
                          {formatHours(row.hours_worked)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-semibold">My Adjustments</h2>
            <p className="text-sm text-gray-500">
              Includes OT, fines, incentives, and deductions (latest 50).
            </p>
          </div>

          <div className="px-5 py-5">
            {safeAdjustments.length === 0 ? (
              <p className="text-sm text-gray-500">No adjustments recorded.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Type
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Hours
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Amount
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">
                        Note
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {safeAdjustments.map((adj, index) => (
                      <tr key={`${adj.effective_date}-${index}`} className="even:bg-gray-50">
                        <td className="px-4 py-2 text-sm">
                          {formatDate(adj.effective_date)}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {KIND_LABELS[adj.kind]}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {formatHours(adj.hours)}
                        </td>
                        <td className="px-4 py-2 text-sm">{formatAmount(adj.amount)}</td>
                        <td className="px-4 py-2 text-sm">
                          {adj.note?.trim() || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
