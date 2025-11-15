'use client'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import AuthGate from '../_components/AuthGate'

type Outlet = { id: string; name: string }
type Worker = { id: string; name: string; phone: string | null; email: string | null; outlet_id: string | null }
type AppUser = { id: string; role: 'admin' | 'manager' | 'worker'; outlet_id: string | null; name: string | null }
type AttendanceLog = {
  id: string
  worker_id: string
  outlet_id: string
  action: 'IN' | 'OUT'
  timestamp_utc: string
  worker_name?: string
  outlet_name?: string
}

type AdjustmentKind = 'ot' | 'fine' | 'incentive' | 'deduction'
type HoursSummary = { weeklyHours: number; monthlyHours: number }
type AdjustmentMessage = { type: 'success' | 'error'; text: string } | null

type ManagerDashboardClientProps = {
  initialProfile?: AppUser | null
  initialOutlets?: Outlet[]
  initialWorkers?: Worker[]
  initialAttendance?: AttendanceLog[]
  hoursSummary?: HoursSummary
  userId?: string
}

const ADJUSTMENT_KINDS: { value: AdjustmentKind; label: string }[] = [
  { value: 'ot', label: 'OT' },
  { value: 'fine', label: 'Fine' },
  { value: 'incentive', label: 'Incentive' },
  { value: 'deduction', label: 'Deduction' },
]

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ManagerDashboardClient({
  initialProfile,
  initialOutlets = [],
  initialWorkers = [],
  initialAttendance = [],
  hoursSummary,
  userId,
}: ManagerDashboardClientProps) {
  const [profile, setProfile] = useState<AppUser | null>(initialProfile ?? null)
  const [outlets, setOutlets] = useState<Outlet[]>(initialOutlets)
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers)
  const [attendance, setAttendance] = useState<AttendanceLog[]>(initialAttendance)
  const [loading, setLoading] = useState(initialAttendance.length === 0)
  const [summary, setSummary] = useState<HoursSummary>(hoursSummary ?? { weeklyHours: 0, monthlyHours: 0 })

  const defaultOutletId =
    initialProfile && initialProfile.role !== 'admin' ? initialProfile.outlet_id ?? '' : ''

  const [form, setForm] = useState({ name: '', phone: '', email: '', outlet_id: defaultOutletId })
  const [aForm, setAForm] = useState<{ worker_id: string; action: 'IN' | 'OUT' }>({ worker_id: '', action: 'IN' })
  const [adjustmentForm, setAdjustmentForm] = useState<{
    worker_id: string
    kind: AdjustmentKind
    hours: string
    amount: string
    note: string
    effective_date: string
  }>({
    worker_id: '',
    kind: 'ot',
    hours: '',
    amount: '',
    note: '',
    effective_date: todayISO(),
  })
  const [adjustmentMessage, setAdjustmentMessage] = useState<AdjustmentMessage>(null)
  const [savingAdjustment, setSavingAdjustment] = useState(false)

  const isAdmin = profile?.role === 'admin'
  const managerOutletId = !isAdmin ? profile?.outlet_id ?? '' : ''

  const formatAttendanceTime = (timestamp: string) => {
    const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(timestamp)
    const normalized = hasOffset ? timestamp : `${timestamp}Z`
    return new Date(normalized).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  }

  // ---- load profile (role/outlet)
  const loadProfile = async () => {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return
    const { data: rows } = await supabase
      .from('app_users')
      .select('id, role, outlet_id, name')
      .eq('id', uid)
      .limit(1)
    if (rows && rows.length) setProfile(rows[0] as AppUser)
  }

  // ---- load outlets, workers, attendance (RLS will auto-scope)
  const loadData = async () => {
    setLoading(true)

    const { data: o } = await supabase.from('outlets').select('id,name').order('name')
    setOutlets(o || [])

    const { data: w } = await supabase
      .from('workers')
      .select('id,name,phone,email,outlet_id')
      .order('name')
    setWorkers(w || [])

    // latest 20 attendance logs (admin = all, manager = own outlet by RLS)
    const { data: logs } = await supabase
      .from('attendance_logs')
      .select('id, worker_id, outlet_id, action, timestamp_utc')
      .order('timestamp_utc', { ascending: false })
      .limit(20)

    // decorate with names for display
    const logsDecorated: AttendanceLog[] = (logs || []).map(l => ({
      ...l,
      worker_name: (w || []).find(x => x.id === l.worker_id)?.name || '—',
      outlet_name: (o || []).find(x => x.id === l.outlet_id)?.name || '—',
    })) as AttendanceLog[]

    setAttendance(logsDecorated)
    setLoading(false)
  }

  const fetchSummary = async () => {
    const now = new Date()
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
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

    const weeklyHoursTotal = weeklyRows?.reduce((sum, row) => sum + (row.hours_worked ?? 0), 0) ?? 0
    const monthlyHoursTotal = monthlyRows?.reduce((sum, row) => sum + (row.hours_worked ?? 0), 0) ?? 0

    setSummary({ weeklyHours: weeklyHoursTotal, monthlyHours: monthlyHoursTotal })
  }

  useEffect(() => {
    if (!profile) {
      ;(async () => { await loadProfile() })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      await loadData()
      if (!isAdmin && managerOutletId) {
        setForm(f => ({ ...f, outlet_id: managerOutletId }))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, managerOutletId])

  useEffect(() => {
    if (!hoursSummary) {
      ;(async () => { await fetchSummary() })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursSummary?.monthlyHours, hoursSummary?.weeklyHours])

  // ---- add worker
  const addWorker = async () => {
    if (!form.name) return alert('Name is required')
    if (isAdmin && !form.outlet_id) return alert('Select an outlet')

    const outletForInsert = isAdmin ? form.outlet_id : managerOutletId
    if (!outletForInsert) return alert('Missing outlet')

    const { error } = await supabase.from('workers').insert({
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      outlet_id: outletForInsert,
    })
    if (error) return alert(error.message)

    setForm({ name: '', phone: '', email: '', outlet_id: isAdmin ? '' : managerOutletId })
    await loadData()
  }

  // ---- add attendance (test)
  const addAttendance = async () => {
    if (!aForm.worker_id) return alert('Select a worker')
    // outlet_id derived:
    const outletForLog = isAdmin
      ? (workers.find(w => w.id === aForm.worker_id)?.outlet_id || '')
      : managerOutletId

    if (!outletForLog) return alert('Missing outlet')

    const { error } = await supabase.from('attendance_logs').insert({
      worker_id: aForm.worker_id,
      outlet_id: outletForLog,
      action: aForm.action,
    })
    if (error) return alert(error.message)

    await loadData()
    await fetchSummary()
  }

  const handleAdjustmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAdjustmentMessage(null)

    if (!adjustmentForm.worker_id) {
      setAdjustmentMessage({ type: 'error', text: 'Select a worker' })
      return
    }

    const worker = workers.find(w => w.id === adjustmentForm.worker_id)
    if (!worker?.outlet_id) {
      setAdjustmentMessage({ type: 'error', text: 'Worker has no outlet' })
      return
    }

    const creator = profile?.id || userId
    if (!creator) {
      setAdjustmentMessage({ type: 'error', text: 'Missing user context' })
      return
    }

    const hoursValue =
      adjustmentForm.kind === 'ot' && adjustmentForm.hours !== '' ? Number(adjustmentForm.hours) : null
    const amountValue =
      adjustmentForm.kind !== 'ot' && adjustmentForm.amount !== '' ? Number(adjustmentForm.amount) : null

    if ((hoursValue !== null && Number.isNaN(hoursValue)) || (amountValue !== null && Number.isNaN(amountValue))) {
      setAdjustmentMessage({ type: 'error', text: 'Invalid number entered' })
      return
    }

    setSavingAdjustment(true)
    const { error } = await supabase.from('worker_adjustments').insert([
      {
        worker_id: adjustmentForm.worker_id,
        outlet_id: worker.outlet_id,
        kind: adjustmentForm.kind,
        hours: adjustmentForm.kind === 'ot' ? hoursValue : null,
        amount: adjustmentForm.kind === 'ot' ? null : amountValue,
        note: adjustmentForm.note.trim() ? adjustmentForm.note.trim() : null,
        effective_date: adjustmentForm.effective_date || todayISO(),
        created_by: creator,
      },
    ])
    setSavingAdjustment(false)

    if (error) {
      setAdjustmentMessage({ type: 'error', text: error.message })
      return
    }

    setAdjustmentMessage({ type: 'success', text: 'Saved adjustment' })
    setAdjustmentForm({ worker_id: '', kind: 'ot', hours: '', amount: '', note: '', effective_date: todayISO() })
  }

  const handleKindChange = (value: AdjustmentKind) => {
    setAdjustmentForm(prev => ({
      ...prev,
      kind: value,
      hours: value === 'ot' ? prev.hours : '',
      amount: value === 'ot' ? '' : prev.amount,
    }))
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <AuthGate>
      {/* App shell */}
      <div className="min-h-screen bg-white text-gray-900">
        {/* Top bar */}
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                Rail Rolls · <span className="text-green-600">Manager Dashboard</span>
              </h1>
              {/* manager outlet badge (keeps role hidden) */}
              {!isAdmin && profile?.outlet_id && outlets.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 border border-green-200">
                  {outlets.find(o => o.id === profile.outlet_id)?.name || 'Outlet'}
                </span>
              )}
            </div>
            <button
              onClick={signOut}
              className="inline-flex items-center rounded-md border border-green-600 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 transition"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">

          {/* Hours Summary */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Hours Summary</h2>
            </div>

            <div className="px-5 py-5">
              <div className="flex flex-col gap-6 md:flex-row md:gap-12">
                <div>
                  <div className="text-sm text-gray-500">This week</div>
                  <div className="text-3xl font-bold text-gray-900">{summary.weeklyHours.toFixed(1)} hrs</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">This month</div>
                  <div className="text-3xl font-bold text-gray-900">{summary.monthlyHours.toFixed(1)} hrs</div>
                </div>
              </div>
            </div>
          </section>

          {/* Add worker card */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Add Worker</h2>
              <p className="text-sm text-gray-500 mt-1">This writes directly into the workers table.</p>
            </div>

            <div className="px-5 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                {isAdmin ? (
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    value={form.outlet_id}
                    onChange={(e) => setForm({ ...form, outlet_id: e.target.value })}
                  >
                    <option value="">Select outlet</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600"
                    value={outlets.find(o => o.id === managerOutletId)?.name || 'Your outlet'}
                  />
                )}
              </div>

              <div className="mt-4">
                <button
                  onClick={addWorker}
                  className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white font-medium shadow-sm hover:bg-green-700 active:bg-green-700/90 transition"
                >
                  Save Worker
                </button>
              </div>
            </div>
          </section>

          {/* Quick Attendance Log */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Quick Attendance</h2>
              <p className="text-sm text-gray-500 mt-1">
                Add a test IN/OUT to validate outlet permissions (RLS).
              </p>
            </div>

            <div className="px-5 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={aForm.worker_id}
                  onChange={(e) => setAForm({ ...aForm, worker_id: e.target.value })}
                >
                  <option value="">Select worker</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>

                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={aForm.action}
                  onChange={(e) => setAForm({ ...aForm, action: e.target.value as 'IN' | 'OUT' })}
                >
                  <option value="IN">IN</option>
                  <option value="OUT">OUT</option>
                </select>

                <button
                  onClick={addAttendance}
                  className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-white font-medium shadow-sm hover:bg-green-700 transition"
                >
                  Save Attendance
                </button>
              </div>
            </div>
          </section>

          {/* Add Adjustment */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Add Adjustment</h2>
              <p className="text-sm text-gray-500 mt-1">Insert OT, fines, incentives, or deductions.</p>
            </div>

            <form className="px-5 py-5 space-y-4" onSubmit={handleAdjustmentSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={adjustmentForm.worker_id}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, worker_id: e.target.value })}
                >
                  <option value="">Select worker</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>

                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={adjustmentForm.kind}
                  onChange={(e) => handleKindChange(e.target.value as AdjustmentKind)}
                >
                  {ADJUSTMENT_KINDS.map(kind => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </select>

                <input
                  type="number"
                  step="0.25"
                  disabled={adjustmentForm.kind !== 'ot'}
                  className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${
                    adjustmentForm.kind !== 'ot' ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-300 bg-white'
                  }`}
                  placeholder="Hours"
                  value={adjustmentForm.hours}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, hours: e.target.value })}
                />

                <input
                  type="number"
                  step="0.01"
                  disabled={adjustmentForm.kind === 'ot'}
                  className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${
                    adjustmentForm.kind === 'ot' ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-300 bg-white'
                  }`}
                  placeholder="Amount"
                  value={adjustmentForm.amount}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })}
                />

                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={adjustmentForm.effective_date}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, effective_date: e.target.value })}
                />

                <textarea
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 md:col-span-2"
                  placeholder="Optional note"
                  value={adjustmentForm.note}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
                />
              </div>

              {adjustmentMessage && (
                <p className={`text-sm ${adjustmentMessage.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                  {adjustmentMessage.text}
                </p>
              )}

              <button
                type="submit"
                disabled={savingAdjustment}
                className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white font-medium shadow-sm hover:bg-green-700 transition disabled:opacity-70"
              >
                {savingAdjustment ? 'Saving...' : 'Save Adjustment'}
              </button>
            </form>
          </section>

          {/* Recent Attendance */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Recent Attendance</h2>
            </div>

            <div className="px-5 py-5">
              {loading ? (
                <div className="text-sm text-gray-500">Loading…</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">When (IST)</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Worker</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Action</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Outlet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {attendance.map(a => (
                        <tr key={a.id} className="even:bg-gray-50">
                          <td className="px-4 py-2 text-sm">{formatAttendanceTime(a.timestamp_utc)}</td>
                          <td className="px-4 py-2 text-sm">{a.worker_name}</td>
                          <td className="px-4 py-2 text-sm">{a.action}</td>
                          <td className="px-4 py-2 text-sm">{a.outlet_name}</td>
                        </tr>
                      ))}
                      {attendance.length === 0 && (
                        <tr>
                          <td className="px-4 py-6 text-sm text-gray-500" colSpan={4}>
                            No logs yet. Use Quick Attendance above to insert a test.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </AuthGate>
  )
}


