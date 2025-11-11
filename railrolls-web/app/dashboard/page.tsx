'use client'
import { useEffect, useState } from 'react'
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

export default function Dashboard() {
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(true)

  // add-worker form
  const [form, setForm] = useState({ name: '', phone: '', email: '', outlet_id: '' })
  // quick attendance form
  const [aForm, setAForm] = useState<{ worker_id: string; action: 'IN' | 'OUT' }>({ worker_id: '', action: 'IN' })

  const isAdmin = profile?.role === 'admin'
  const managerOutletId = !isAdmin ? profile?.outlet_id ?? '' : ''

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

  useEffect(() => { (async () => { await loadProfile() })() }, [])
  useEffect(() => {
    (async () => {
      await loadData()
      if (!isAdmin && managerOutletId) {
        setForm(f => ({ ...f, outlet_id: managerOutletId }))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, managerOutletId])

  // ---- add worker
  const addWorker = async () => {
    if (!form.name) return alert('Name is required')
    if (isAdmin && !form.outlet_id) return alert('Select an outlet')

    const outletForInsert = isAdmin ? form.outlet_id : managerOutletId
    const { error } = await supabase.from('workers').insert({
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      outlet_id: outletForInsert
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
      // timestamp_utc defaults to now()
    })
    if (error) return alert(error.message)

    // refresh list
    await loadData()
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

          {/* Add worker card */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Add Worker</h2>
              <p className="text-sm text-gray-500 mt-1">Assign a worker to an outlet and keep records clean.</p>
            </div>

            <div className="px-5 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Name"
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
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">When (UTC)</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Worker</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Action</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Outlet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {attendance.map(a => (
                        <tr key={a.id} className="even:bg-gray-50">
                          <td className="px-4 py-2 text-sm">{new Date(a.timestamp_utc).toLocaleString()}</td>
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
