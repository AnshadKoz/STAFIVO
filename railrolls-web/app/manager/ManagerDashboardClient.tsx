'use client'

import { FormEvent, ReactNode, useActionState, useEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/app/_components/ToastProvider'
import AuthGate from '../_components/AuthGate'
import {
  createWorkerRequestAction,
  markNotificationReadAction,
  respondToFineAppealAction,
  logAttendanceAction,
  type ManagerActionResult,
} from './managerActions'
import {
  approveWorkerRequestAction,
  rejectWorkerRequestAction,
  saveOutletAction,
  deleteOutletAction,
  createManagerAction,
  updateManagerAction,
  logAdminAttendanceAction,
  createWorkerAction,
  type ActionResult,
} from '@/app/admin/adminActions'

type Outlet = {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
  radius_meters?: number | null
}

type Worker = {
  id: string
  name: string
  phone: string | null
  email: string | null
  outlet_id: string | null
  base_salary_per_hour: number | null
  ot_rate_per_hour: number | null
  outletName?: string | null
}

type AppUser = {
  id: string
  role: 'admin' | 'manager' | 'worker'
  outlet_id: string | null
  name: string | null
}

type AttendanceLog = {
  id: string
  worker_id: string
  outlet_id: string
  action: 'IN' | 'OUT'
  timestamp_utc: string
  worker_name?: string
  outlet_name?: string
}

type WorkerOnboardingRequest = {
  id: string
  name: string
  phone: string | null
  email: string | null
  base_salary_per_hour: number | null
  ot_rate_per_hour: number | null
  outlet_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string
  created_at?: string
  admin_comment?: string | null
}

type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  is_read: boolean
  created_at: string
}

type FineAppealRow = {
  id: string
  worker_id: string
  adjustment_id: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  manager_response: string | null
  worker_name?: string | null
  worker?: { id: string; name: string | null } | null
  amount?: number | null
}

type AdminManagerRow = {
  id: string
  app_user_id: string
  name: string | null
  email: string | null
  outlet_id: string | null
  outlet_name?: string | null
  is_active: boolean
}

type ManagerCandidate = {
  id: string
  name: string | null
  email: string | null
}

type OutletAnalyticsPoint = {
  outlet_id: string
  outlet_name: string
  total_hours: number
  total_ot_hours: number
}

type WorkerAnalyticsPoint = {
  worker_id: string
  worker_name: string
  total_hours: number
  ot_hours: number
}

type WorkerDocument = {
  id: string
  kind: 'bank_passbook' | 'health_card' | 'other'
  storage_path: string
  original_name: string
  created_at: string
  signedUrl?: string | null
}

type HoursSummary = {
  weeklyHours: number
  monthlyHours: number
}

type DashboardCard = {
  id: string
  title: string
  description: string
  accent: string
  stat: string
  detail: string
  content: ReactNode
}

type ManagerDashboardClientProps = {
  initialProfile?: AppUser | null
  initialOutlets?: Outlet[] | null
  initialWorkers?: Worker[] | null
  initialAttendance?: AttendanceLog[] | null
  hoursSummary?: HoursSummary | null
  userId?: string
  workerRequests?: WorkerOnboardingRequest[] | null
  notifications?: NotificationRow[] | null
  fineAppeals?: FineAppealRow[] | null
  adminManagerRows?: AdminManagerRow[] | null
  managerCandidates?: ManagerCandidate[] | null
  outletAnalytics?: OutletAnalyticsPoint[] | null
  workerAnalytics?: WorkerAnalyticsPoint[] | null
  workerAnalyticsWeekly?: WorkerAnalyticsPoint[] | null
  managerOutlet?: { id: string; name: string | null } | null
  adminPayrollPanel?: ReactNode
  dashboardTitle?: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const formatCurrency = (value: number | null | undefined) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(value)
    : 'Not set'

const formatRate = (value: number | null | undefined) =>
  typeof value === 'number' ? `${formatCurrency(value)}/hr` : 'Not set'

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })

const actionStateInit: ManagerActionResult = { status: 'success' }
const adminActionInit: ActionResult = { status: 'success' }

export default function ManagerDashboardClient({
  initialProfile = null,
  initialOutlets,
  initialWorkers,
  initialAttendance,
  hoursSummary,
  userId,
  workerRequests,
  notifications,
  fineAppeals,
  adminManagerRows,
  managerCandidates,
  outletAnalytics,
  workerAnalytics,
  workerAnalyticsWeekly,
  managerOutlet = null,
  adminPayrollPanel,
  dashboardTitle,
}: ManagerDashboardClientProps) {
  const resolvedInitialOutlets = initialOutlets ?? []
  const resolvedInitialWorkers = initialWorkers ?? []
  const resolvedInitialAttendance = initialAttendance ?? []
  const summaryWeekly = hoursSummary?.weeklyHours ?? 0
  const summaryMonthly = hoursSummary?.monthlyHours ?? 0
  const resolvedRequests = workerRequests ?? []
  const resolvedNotifications = notifications ?? []
  const resolvedAppeals = fineAppeals ?? []
  const resolvedManagerRows = adminManagerRows ?? []
  const resolvedCandidates = managerCandidates ?? []
  const resolvedOutletAnalytics = outletAnalytics ?? []
  const resolvedWorkerAnalytics = workerAnalytics ?? []
  const resolvedWorkerAnalyticsWeekly = workerAnalyticsWeekly ?? []
  const resolvedManagerOutlet = managerOutlet ?? null

  const router = useRouter()
  const { showToast } = useToast()
  const [profile, setProfile] = useState<AppUser | null>(initialProfile)
  const [outlets, setOutlets] = useState<Outlet[]>(resolvedInitialOutlets)
  const [workers, setWorkers] = useState<Worker[]>(resolvedInitialWorkers)
  const [attendance, setAttendance] = useState<AttendanceLog[]>(resolvedInitialAttendance)
  const [summary, setSummary] = useState<HoursSummary>({ weeklyHours: summaryWeekly, monthlyHours: summaryMonthly })
  const [requests, setRequests] = useState<WorkerOnboardingRequest[]>(resolvedRequests)
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>(resolvedNotifications)
  const [appeals, setAppeals] = useState<FineAppealRow[]>(resolvedAppeals)
  const [managerRows, setManagerRows] = useState<AdminManagerRow[]>(resolvedManagerRows)
  const [candidates, setCandidates] = useState<ManagerCandidate[]>(resolvedCandidates)
  const [outletTrends, setOutletTrends] = useState<OutletAnalyticsPoint[]>(resolvedOutletAnalytics)
  const [workerTrends, setWorkerTrends] = useState<WorkerAnalyticsPoint[]>(resolvedWorkerAnalytics)
  const [workerTrendsWeekly, setWorkerTrendsWeekly] =
    useState<WorkerAnalyticsPoint[]>(resolvedWorkerAnalyticsWeekly)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [documentsModal, setDocumentsModal] = useState<{ open: boolean; workerId: string }>({
    open: false,
    workerId: '',
  })
  const [documents, setDocuments] = useState<WorkerDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [analyticsMode, setAnalyticsMode] = useState<'month' | 'week'>('month')

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    outlet_id: resolvedManagerOutlet?.id ?? initialProfile?.outlet_id ?? '',
    base_salary_per_hour: '',
    ot_rate_per_hour: '',
  })
  const [aForm, setAForm] = useState<{ worker_id: string; action: 'IN' | 'OUT' }>({
    worker_id: '',
    action: 'IN',
  })
  const [attendanceTime, setAttendanceTime] = useState('')
  const [adjustmentForm, setAdjustmentForm] = useState<{
    worker_id: string
    kind: 'ot' | 'fine' | 'incentive' | 'deduction'
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

  const [workerMessage, setWorkerMessage] = useState<string | null>(null)
  const [attendanceMessage, setAttendanceMessage] = useState<string | null>(null)
  const [adjustmentMessage, setAdjustmentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )
  const [savingAdjustment, setSavingAdjustment] = useState(false)
  const [outletForm, setOutletForm] = useState({
    outlet_id: '',
    name: '',
    latitude: '',
    longitude: '',
    radius_meters: '',
  })
  const [managerMode, setManagerMode] = useState<'existing' | 'new'>('existing')
  const [requestComments, setRequestComments] = useState<Record<string, string>>({})
  const [currentAppeal, setCurrentAppeal] = useState<FineAppealRow | null>(null)
  const [appealResponse, setAppealResponse] = useState('')
  const [appealDecision, setAppealDecision] = useState<'approve' | 'reject'>('approve')
  const appealActionInitRef = useRef(true)
  const lastAppealMetaRef = useRef<{ id: string | null; decision: 'approve' | 'reject' }>({
    id: null,
    decision: 'approve',
  })

  const [requestState, workerRequestAction] = useActionState(createWorkerRequestAction, actionStateInit)
  const [outletState, outletAction] = useActionState(saveOutletAction, adminActionInit)
  const [deleteOutletState, deleteOutletFormAction] = useActionState(deleteOutletAction, adminActionInit)
  const [createManagerState, managerCreateAction] = useActionState(createManagerAction, adminActionInit)
  const [updateManagerState, managerUpdateAction] = useActionState(updateManagerAction, adminActionInit)
  const [appealActionState, respondToAppealAction, appealActionPending] = useActionState(
    respondToFineAppealAction,
    actionStateInit
  )
  const [, approveRequestAction] = useActionState(approveWorkerRequestAction, actionStateInit)
  const [, rejectRequestAction] = useActionState(rejectWorkerRequestAction, actionStateInit)
  const [, markNotificationAction] = useActionState(markNotificationReadAction, actionStateInit)

  const isAdmin = profile?.role === 'admin'
  const attendanceServerAction = isAdmin ? logAdminAttendanceAction : logAttendanceAction
  const [attendanceState, attendanceActionDispatch] = useActionState(attendanceServerAction, actionStateInit)
  const managerOutletId = resolvedManagerOutlet?.id ?? (!isAdmin ? profile?.outlet_id ?? '' : '')
  const managerOutletName =
    resolvedManagerOutlet?.name ??
    (managerOutletId
      ? outlets.find(outlet => outlet.id === managerOutletId)?.name ?? 'Outlet not set'
      : isAdmin
        ? 'All outlets'
        : 'Outlet not set')

  const resolveOutletName = (workerOutletId: string | null) => {
    if (workerOutletId && workerOutletId === resolvedManagerOutlet?.id && resolvedManagerOutlet?.name) {
      return resolvedManagerOutlet.name
    }
    const outletName = outlets.find(outlet => outlet.id === workerOutletId)?.name
    if (outletName) return outletName
    return managerOutletName
  }
  const title = dashboardTitle ?? (isAdmin ? 'Rail Rolls · Admin Dashboard' : 'Rail Rolls · Manager Dashboard')

  const openAppealModal = (appeal: FineAppealRow) => {
    setCurrentAppeal(appeal)
    setAppealResponse(appeal.manager_response ?? '')
    setAppealDecision('approve')
    lastAppealMetaRef.current = { id: appeal.id, decision: 'approve' }
  }

  const closeAppealModal = () => {
    setCurrentAppeal(null)
    setAppealResponse('')
    setAppealDecision('approve')
    lastAppealMetaRef.current = { id: null, decision: 'approve' }
  }

  const handleDecisionSelect = (value: 'approve' | 'reject') => {
    setAppealDecision(value)
    lastAppealMetaRef.current = { id: currentAppeal?.id ?? null, decision: value }
  }

  useEffect(() => {
    setProfile(initialProfile)
  }, [initialProfile])

  useEffect(() => {
    setOutlets(initialOutlets ?? [])
  }, [initialOutlets])

  useEffect(() => {
    setWorkers(initialWorkers ?? [])
  }, [initialWorkers])

  useEffect(() => {
    setAttendance(initialAttendance ?? [])
  }, [initialAttendance])

  useEffect(() => {
    setSummary({ weeklyHours: summaryWeekly, monthlyHours: summaryMonthly })
  }, [summaryWeekly, summaryMonthly])

  useEffect(() => {
    setRequests(workerRequests ?? [])
  }, [workerRequests])

  useEffect(() => {
    if (appealActionInitRef.current) {
      appealActionInitRef.current = false
      return
    }

    if (appealActionState.status === 'success') {
      const handledId = lastAppealMetaRef.current.id
      if (handledId) {
        setAppeals(prev => prev.filter(appeal => appeal.id !== handledId))
      }
      showToast({
        type: 'success',
        title: 'Appeal updated',
        description: 'The worker has been notified.',
      })
      setCurrentAppeal(null)
      setAppealResponse('')
      setAppealDecision('approve')
      lastAppealMetaRef.current = { id: null, decision: 'approve' }
    } else if (appealActionState.status === 'error') {
      showToast({
        type: 'error',
        title: 'Unable to update appeal',
        description: appealActionState.message ?? 'Please try again in a moment.',
      })
    }
  }, [appealActionState, showToast])

  useEffect(() => {
    setNotificationRows(notifications ?? [])
  }, [notifications])

  useEffect(() => {
    setAppeals(fineAppeals ?? [])
  }, [fineAppeals])

  useEffect(() => {
    setManagerRows(adminManagerRows ?? [])
  }, [adminManagerRows])

  useEffect(() => {
    setCandidates(managerCandidates ?? [])
  }, [managerCandidates])

  useEffect(() => {
    setOutletTrends(outletAnalytics ?? [])
  }, [outletAnalytics])

  useEffect(() => {
    setWorkerTrends(workerAnalytics ?? [])
  }, [workerAnalytics])

  useEffect(() => {
    setWorkerTrendsWeekly(workerAnalyticsWeekly ?? [])
  }, [workerAnalyticsWeekly])

  useEffect(() => {
    if (!isAdmin) {
      setForm(prev => ({ ...prev, outlet_id: managerOutletId }))
    }
  }, [isAdmin, managerOutletId])

  useEffect(() => {
    if (!isAdmin && requestState.status === 'success' && requestState.message) {
      setForm({
        name: '',
        phone: '',
        email: '',
        outlet_id: managerOutletId,
        base_salary_per_hour: '',
        ot_rate_per_hour: '',
      })
      setWorkerMessage(requestState.message)
      router.refresh()
    } else if (!isAdmin && requestState.status === 'error' && requestState.message) {
      setWorkerMessage(requestState.message)
    }
  }, [isAdmin, requestState.status, requestState.message, managerOutletId, router])

  useEffect(() => {
    if (attendanceState.message) {
      setAttendanceMessage(attendanceState.message)
    }
  }, [attendanceState.message])

  useEffect(() => {
    if (outletState.status === 'success') {
      setOutletForm({ outlet_id: '', name: '', latitude: '', longitude: '', radius_meters: '' })
    }
  }, [outletState.status])

  const formatAttendanceTime = (timestamp: string) => {
    const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(timestamp)
    const normalized = hasOffset ? timestamp : `${timestamp}Z`
    return new Date(normalized).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  }

  const loadData = async () => {
    const { data: o } = await supabase.from('outlets').select('id,name,latitude,longitude,radius_meters').order('name')
    setOutlets(o || [])

    const { data: w } = await supabase
      .from('workers')
      .select('id,name,phone,email,outlet_id,base_salary_per_hour,ot_rate_per_hour')
      .order('name')
    setWorkers(w || [])

    const { data: logs } = await supabase
      .from('attendance_logs')
      .select('id, worker_id, outlet_id, action, timestamp_utc')
      .order('timestamp_utc', { ascending: false })
      .limit(20)

    const logsDecorated: AttendanceLog[] = (logs || []).map(l => ({
      ...l,
      worker_name: (w || []).find(x => x.id === l.worker_id)?.name || '-',
      outlet_name: (o || []).find(x => x.id === l.outlet_id)?.name || '-',
    }))

    setAttendance(logsDecorated)
  }

  const addWorker = async () => {
    if (!isAdmin) return
    if (!form.name.trim()) {
      setWorkerMessage('Name is required')
      return
    }
    const formData = new FormData()
    formData.append('name', form.name)
    if (form.phone) formData.append('phone', form.phone)
    if (form.email) formData.append('email', form.email)
    if (form.outlet_id) formData.append('outlet_id', form.outlet_id)
    if (form.base_salary_per_hour) formData.append('base_salary_per_hour', form.base_salary_per_hour)
    if (form.ot_rate_per_hour) formData.append('ot_rate_per_hour', form.ot_rate_per_hour)

    const result = await createWorkerAction(adminActionInit, formData)

    if (result.status === 'error') {
      setWorkerMessage(result.message || 'Failed to create worker')
      return
    }

    setWorkerMessage('Worker saved')

    setForm({
      name: '',
      phone: '',
      email: '',
      outlet_id: form.outlet_id,
      base_salary_per_hour: '',
      ot_rate_per_hour: '',
    })
    await loadData()
    router.refresh()
  }

  const handleAdjustmentSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const worker = workers.find(w => w.id === adjustmentForm.worker_id)
    if (!worker) {
      setAdjustmentMessage({ type: 'error', text: 'Select worker' })
      return
    }
    if (adjustmentForm.kind === 'ot' && !adjustmentForm.hours) {
      setAdjustmentMessage({ type: 'error', text: 'Enter OT hours' })
      return
    }
    if (adjustmentForm.kind !== 'ot' && !adjustmentForm.amount) {
      setAdjustmentMessage({ type: 'error', text: 'Enter amount' })
      return
    }
    setSavingAdjustment(true)
    const hoursValue = adjustmentForm.hours === '' ? null : Number(adjustmentForm.hours)
    const amountValue = adjustmentForm.amount === '' ? null : Number(adjustmentForm.amount)
    const { data: creatorData } = await supabase.auth.getUser()
    const creator = creatorData.user?.id ?? userId ?? null

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

  const handleKindChange = (value: 'ot' | 'fine' | 'incentive' | 'deduction') => {
    setAdjustmentForm(prev => ({
      ...prev,
      kind: value,
      hours: value === 'ot' ? prev.hours : '',
      amount: value === 'ot' ? '' : prev.amount,
    }))
  }

  const handleOutletSelect = (id: string) => {
    if (!id) {
      setOutletForm({ outlet_id: '', name: '', latitude: '', longitude: '', radius_meters: '' })
      return
    }
    const outlet = outlets.find(o => o.id === id)
    if (outlet) {
      setOutletForm({
        outlet_id: outlet.id,
        name: outlet.name,
        latitude: outlet.latitude?.toString() ?? '',
        longitude: outlet.longitude?.toString() ?? '',
        radius_meters: outlet.radius_meters?.toString() ?? '',
      })
    }
  }

  const openDocumentsModal = async (workerId: string) => {
    setDocumentsModal({ open: true, workerId })
    setDocumentsLoading(true)
    const { data: docs } = await supabase
      .from('worker_documents')
      .select('id,kind,storage_path,original_name,created_at')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false })

    const withUrls: WorkerDocument[] = []
    if (docs) {
      for (const doc of docs) {
        const { data: signed } = await supabase.storage.from('worker-docs').createSignedUrl(doc.storage_path, 60 * 60)
        withUrls.push({ ...doc, signedUrl: signed?.signedUrl ?? null })
      }
    }
    setDocuments(withUrls)
    setDocumentsLoading(false)
  }

  const handleAttendanceAction = async (formData: FormData) => {
    await attendanceActionDispatch(formData)
    await loadData()
    setAForm({ worker_id: '', action: 'IN' })
    setAttendanceTime('')
  }

  const cards: DashboardCard[] = [
    {
      id: 'workers',
      title: isAdmin ? 'Workforce' : 'My Team',
      description: 'Manage worker roster and rates.',
      accent: 'from-emerald-500 to-green-500',
      stat: workers.length.toString(),
      detail: 'Active workers',
      content: (
        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold tracking-wide text-emerald-600">Create worker</h4>
            {isAdmin ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <select
                    value={form.outlet_id}
                    onChange={e => setForm({ ...form, outlet_id: e.target.value })}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Select outlet</option>
                    {outlets.map(outlet => (
                      <option key={outlet.id} value={outlet.id}>
                        {outlet.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="Phone"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={form.base_salary_per_hour}
                    onChange={e => setForm({ ...form, base_salary_per_hour: e.target.value })}
                    placeholder="Base rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={form.ot_rate_per_hour}
                    onChange={e => setForm({ ...form, ot_rate_per_hour: e.target.value })}
                    placeholder="OT rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={addWorker}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700"
                  >
                    Create worker
                  </button>
                  {workerMessage ? <span className="text-sm text-gray-600">{workerMessage}</span> : null}
                </div>
              </>
            ) : (
              <form action={workerRequestAction} className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    name="name"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name"
                    required
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outlet</p>
                    <p className="text-sm font-semibold text-gray-900">{managerOutletName}</p>
                  </div>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="Phone"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    name="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    name="base_salary_per_hour"
                    value={form.base_salary_per_hour}
                    onChange={e => setForm({ ...form, base_salary_per_hour: e.target.value })}
                    placeholder="Base rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    name="ot_rate_per_hour"
                    value={form.ot_rate_per_hour}
                    onChange={e => setForm({ ...form, ot_rate_per_hour: e.target.value })}
                    placeholder="OT rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <input type="hidden" name="outlet_id" value={managerOutletId} />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700"
                  >
                    Send approval request
                  </button>
                  {workerMessage ? <span className="text-sm text-gray-600">{workerMessage}</span> : null}
                </div>
              </form>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Outlet</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Base</th>
                  <th className="px-3 py-2">OT</th>
                </tr>
              </thead>
              <tbody>
                {workers.map(worker => (
                  <tr key={worker.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{worker.name}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {worker.outletName ?? resolveOutletName(worker.outlet_id)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{worker.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{worker.email ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{formatRate(worker.base_salary_per_hour)}</td>
                    <td className="px-3 py-2 text-gray-600">{formatRate(worker.ot_rate_per_hour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'attendance',
      title: 'Attendance',
      description: 'Drop quick IN/OUT entries, optionally backdating the time.',
      accent: 'from-green-400 to-emerald-500',
      stat: attendance.length ? attendance[0].action : 'IN',
      detail: attendance.length ? `${attendance[0].worker_name ?? ''}` : 'No records',
      content: (
        <div className="space-y-6">
          <form className="grid gap-3 md:grid-cols-4" action={handleAttendanceAction}>
            <select
              name="worker_id"
              value={aForm.worker_id}
              onChange={e => setAForm({ ...aForm, worker_id: e.target.value })}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              required
            >
              <option value="">Select worker</option>
              {workers.map(worker => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
            <select
              name="action"
              value={aForm.action}
              onChange={e => setAForm({ ...aForm, action: e.target.value as 'IN' | 'OUT' })}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
            <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">Time (optional)</label>
              <input
                type="time"
                name="time"
                value={attendanceTime}
                onChange={e => setAttendanceTime(e.target.value)}
                className="mt-1 text-sm text-gray-900 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700"
            >
              Log attendance
            </button>
          </form>
          {attendanceMessage ? <p className="text-sm text-gray-600">{attendanceMessage}</p> : null}
          <div className="space-y-2">
            {attendance.map(log => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold">{log.worker_name ?? 'Worker'}</p>
                  <p className="text-xs text-gray-500">{log.outlet_name ?? 'Outlet'} · {log.action}</p>
                </div>
                <p className="text-xs text-gray-500">{formatAttendanceTime(log.timestamp_utc)}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'adjustments',
      title: 'Adjustments',
      description: 'Insert OT, fines, incentives, or deductions.',
      accent: 'from-lime-400 to-emerald-400',
      stat: '₹',
      detail: 'Manual edits',
      content: (
        <form className="space-y-4" onSubmit={handleAdjustmentSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={adjustmentForm.worker_id}
              onChange={e => setAdjustmentForm({ ...adjustmentForm, worker_id: e.target.value })}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">Select worker</option>
              {workers.map(worker => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
            <select
              value={adjustmentForm.kind}
              onChange={e => handleKindChange(e.target.value as 'ot' | 'fine' | 'incentive' | 'deduction')}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="ot">OT</option>
              <option value="fine">Fine</option>
              <option value="incentive">Incentive</option>
              <option value="deduction">Deduction</option>
            </select>
            {adjustmentForm.kind === 'ot' ? (
              <input
                type="number"
                step="0.25"
                value={adjustmentForm.hours}
                onChange={e => setAdjustmentForm({ ...adjustmentForm, hours: e.target.value })}
                placeholder="Hours"
                className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            ) : (
              <input
                type="number"
                step="0.01"
                value={adjustmentForm.amount}
                onChange={e => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })}
                placeholder="Amount (₹)"
                className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            )}
            <input
              type="date"
              value={adjustmentForm.effective_date}
              onChange={e => setAdjustmentForm({ ...adjustmentForm, effective_date: e.target.value })}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <textarea
            value={adjustmentForm.note}
            onChange={e => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
            placeholder="Note"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={savingAdjustment}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {savingAdjustment ? 'Saving...' : 'Save adjustment'}
          </button>
          {adjustmentMessage ? (
            <p
              className={`text-sm ${adjustmentMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                }`}
            >
              {adjustmentMessage.text}
            </p>
          ) : null}
        </form>
      ),
    },
  ]

  const pendingRequests = requests.filter(request => request.status === 'pending')

  if (!isAdmin) {
    cards.push(
      {
        id: 'requests',
        title: 'Worker Requests',
        description: 'Send onboarding requests to HQ for approval.',
        accent: 'from-emerald-400 to-sky-400',
        stat: pendingRequests.length.toString(),
        detail: 'Pending approvals',
        content: (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Submit new teammates through the “Add worker” form above. Every pending request shows up here until admin
              responds.
            </p>
            <div className="space-y-3">
              {requests.length === 0 ? (
                <p className="text-sm text-gray-500">No requests submitted yet.</p>
              ) : (
                requests.map(request => (
                  <div key={request.id} className="rounded-2xl border border-gray-100 px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{request.name}</p>
                        <p className="text-xs text-gray-500">{request.email ?? request.phone ?? '—'}</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${request.status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : request.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                          }`}
                      >
                        {request.status}
                      </span>
                    </div>
                    {request.admin_comment ? (
                      <p className="mt-2 text-xs text-gray-500">Admin: {request.admin_comment}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        ),
      },
      {
        id: 'appeals',
        title: 'Fine Appeals',
        description: 'Review pending worker appeals and respond.',
        accent: 'from-emerald-500 to-amber-400',
        stat: appeals.length.toString(),
        detail: 'Pending appeals',
        content: (
          <div className="space-y-4">
            {appeals.length === 0 ? (
              <p className="text-sm text-gray-500">No appeals assigned to you.</p>
            ) : (
              appeals.map(appeal => (
                <div key={appeal.id} className="rounded-2xl border border-gray-100 px-4 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{appeal.worker_name ?? 'Worker'}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(appeal.created_at)}</p>
                      <p className="mt-2 text-sm text-gray-600">Reason: {appeal.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAppealModal(appeal)}
                      className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Review
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ),
      },
      {
        id: 'documents',
        title: 'Documents',
        description: 'View worker document uploads.',
        accent: 'from-green-500 to-cyan-400',
        stat: 'Docs',
        detail: 'Per worker',
        content: (
          <div className="space-y-3">
            {workers.length === 0 ? (
              <p className="text-sm text-gray-500">No workers available.</p>
            ) : (
              workers.map(worker => (
                <div
                  key={worker.id}
                  className="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3 shadow-sm"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{worker.name}</p>
                    <p className="text-xs text-gray-500">
                      {outlets.find(o => o.id === worker.outlet_id)?.name ?? '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDocumentsModal(worker.id)}
                    className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                  >
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        ),
      }
    )
  } else {
    cards.push(
      {
        id: 'outlets',
        title: 'Outlets',
        description: 'Create, edit, and delete outlet geofences.',
        accent: 'from-emerald-500 to-slate-500',
        stat: outlets.length.toString(),
        detail: 'Active outlets',
        content: (
          <div className="space-y-5">
            <form action={outletAction} className="space-y-3">
              <input type="hidden" name="outlet_id" value={outletForm.outlet_id} />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  name="name"
                  value={outletForm.name}
                  onChange={e => setOutletForm({ ...outletForm, name: e.target.value })}
                  placeholder="Outlet name"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
                <input
                  name="latitude"
                  value={outletForm.latitude}
                  onChange={e => setOutletForm({ ...outletForm, latitude: e.target.value })}
                  placeholder="Latitude"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  name="longitude"
                  value={outletForm.longitude}
                  onChange={e => setOutletForm({ ...outletForm, longitude: e.target.value })}
                  placeholder="Longitude"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  name="radius_meters"
                  value={outletForm.radius_meters}
                  onChange={e => setOutletForm({ ...outletForm, radius_meters: e.target.value })}
                  placeholder="Radius (m)"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                >
                  {outletForm.outlet_id ? 'Update outlet' : 'Create outlet'}
                </button>
                <button
                  type="button"
                  onClick={() => handleOutletSelect('')}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700"
                >
                  New outlet
                </button>
              </div>
              {outletState.message ? <p className="text-sm text-gray-600">{outletState.message}</p> : null}
            </form>
            <div className="space-y-3">
              {outlets.map(outlet => (
                <div
                  key={outlet.id}
                  className="flex flex-col gap-3 rounded-2xl border border-gray-100 px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold">{outlet.name}</p>
                    <p className="text-xs text-gray-500">
                      Lat {outlet.latitude ?? '—'} · Lng {outlet.longitude ?? '—'} · Radius {outlet.radius_meters ?? '—'} m
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleOutletSelect(outlet.id)}
                      className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700"
                    >
                      Edit
                    </button>
                    <form
                      action={deleteOutletFormAction}
                      onSubmit={e => {
                        if (!confirm(`Delete ${outlet.name}?`)) e.preventDefault()
                      }}
                    >
                      <input type="hidden" name="outlet_id" value={outlet.id} />
                      <button
                        type="submit"
                        className="rounded-xl bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
              {deleteOutletState.message ? (
                <p className="text-sm text-gray-600">{deleteOutletState.message}</p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: 'managers',
        title: 'Managers',
        description: 'Link app users to outlets and toggle access.',
        accent: 'from-emerald-500 to-indigo-500',
        stat: managerRows.length.toString(),
        detail: 'Active managers',
        content: (
          <div className="space-y-6">
            <form action={managerCreateAction} className="space-y-3 rounded-2xl border border-gray-100 px-4 py-4 shadow-sm">
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="radio"
                    name="mode"
                    value="existing"
                    checked={managerMode === 'existing'}
                    onChange={() => setManagerMode('existing')}
                  />
                  Link existing user
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="radio"
                    name="mode"
                    value="new"
                    checked={managerMode === 'new'}
                    onChange={() => setManagerMode('new')}
                  />
                  Create new manager
                </label>
              </div>
              {managerMode === 'existing' ? (
                <select
                  name="app_user_id"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">Select manager user</option>
                  {candidates.map(candidate => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name ?? candidate.email ?? candidate.id}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    name="name"
                    placeholder="Full name"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              )}
              <select
                name="outlet_id"
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Assign outlet</option>
                {outlets.map(outlet => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" name="is_active" defaultChecked />
                Active
              </label>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700"
              >
                Save manager
              </button>
              {createManagerState.message ? (
                <p className="text-sm text-gray-600">{createManagerState.message}</p>
              ) : null}
            </form>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Manager</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Outlet</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {managerRows.map(row => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-semibold">{row.name ?? 'Manager'}</td>
                      <td className="px-3 py-2 text-gray-600">{row.email ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">
                        <select
                          name="outlet_id"
                          value={row.outlet_id ?? ''}
                          onChange={e =>
                            setManagerRows(prev =>
                              prev.map(m => (m.id === row.id ? { ...m, outlet_id: e.target.value } : m))
                            )
                          }
                          className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                        >
                          <option value="">Unassigned</option>
                          {outlets.map(outlet => (
                            <option key={outlet.id} value={outlet.id}>
                              {outlet.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        <input
                          type="checkbox"
                          checked={row.is_active}
                          onChange={e =>
                            setManagerRows(prev =>
                              prev.map(m => (m.id === row.id ? { ...m, is_active: e.target.checked } : m))
                            )
                          }
                          className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={managerUpdateAction} className="flex items-center gap-2">
                          <input type="hidden" name="manager_id" value={row.id} />
                          <input type="hidden" name="app_user_id" value={row.app_user_id} />
                          <input type="hidden" name="outlet_id" value={row.outlet_id ?? ''} />
                          <input type="hidden" name="is_active" value={row.is_active ? 'on' : ''} />
                          <button
                            type="submit"
                            className="rounded-xl border border-gray-200 px-4 py-1.5 text-xs font-semibold text-gray-700"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {updateManagerState.message ? (
                <p className="mt-3 text-sm text-gray-600">{updateManagerState.message}</p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: 'pending-workers',
        title: 'Pending Workers',
        description: 'Approve or reject onboarding requests from managers.',
        accent: 'from-emerald-500 to-orange-400',
        stat: requests.length.toString(),
        detail: 'Waiting for decision',
        content: (
          <div className="space-y-4">
            {requests.length === 0 ? (
              <p className="text-sm text-gray-500">All caught up!</p>
            ) : (
              requests.map(request => (
                <form
                  key={request.id}
                  className="rounded-2xl border border-gray-100 px-4 py-4 shadow-sm"
                >
                  <input type="hidden" name="request_id" value={request.id} />
                  <p className="text-sm font-semibold">{request.name}</p>
                  <p className="text-xs text-gray-500">
                    {request.email ?? request.phone ?? '—'} · Outlet: {outlets.find(o => o.id === request.outlet_id)?.name ?? '—'}
                  </p>
                  <textarea
                    name="admin_comment"
                    value={requestComments[request.id] ?? ''}
                    onChange={e => setRequestComments(prev => ({ ...prev, [request.id]: e.target.value }))}
                    placeholder="Comment"
                    className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="mt-3 flex gap-3">
                    <button
                      type="submit"
                      formAction={approveRequestAction}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                    <button
                      type="submit"
                      formAction={rejectRequestAction}
                      className="rounded-xl bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 shadow hover:bg-red-200"
                    >
                      Reject
                    </button>
                  </div>
                </form>
              ))
            )}
          </div>
        ),
      },
      {
        id: 'payroll',
        title: 'Payroll & Analytics',
        description: 'Generate payroll runs and print payslips.',
        accent: 'from-emerald-600 to-slate-600',
        stat: '₹',
        detail: 'Payroll tools',
        content: (
          <div className="space-y-4">
            {adminPayrollPanel}
            <div className="rounded-2xl border border-gray-100 p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-gray-700">Hours by outlet (30 days)</h4>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={outletTrends}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="outlet_name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="total_hours" fill="#10b981" name="Hours" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="total_ot_hours" fill="#34d399" name="OT hours" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ),
      }
    )
  }

  const analyticsData = analyticsMode === 'week' ? workerTrendsWeekly : workerTrends
  const analyticsLabel = analyticsMode === 'week' ? 'Last 7 days' : 'This month'

  const workerAnalyticsCard = {
    id: 'analytics',
    title: 'Team Analytics',
    description: 'Hours vs OT for your team',
    accent: 'from-emerald-400 to-cyan-400',
    stat: analyticsData.reduce((sum, item) => sum + item.total_hours, 0).toFixed(1),
    detail: analyticsLabel,
    content: (
      <div>
        <div className="mb-4 inline-flex rounded-full bg-emerald-50 p-1 text-xs font-semibold text-emerald-700">
          <button
            type="button"
            onClick={() => setAnalyticsMode('month')}
            className={`rounded-full px-3 py-1 transition ${analyticsMode === 'month' ? 'bg-white shadow text-emerald-700' : 'text-emerald-500'
              }`}
          >
            This month
          </button>
          <button
            type="button"
            onClick={() => setAnalyticsMode('week')}
            className={`rounded-full px-3 py-1 transition ${analyticsMode === 'week' ? 'bg-white shadow text-emerald-700' : 'text-emerald-500'
              }`}
          >
            This week
          </button>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analyticsData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="worker_name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="total_hours" fill="#10b981" name="Hours" radius={[8, 8, 0, 0]} />
              <Bar dataKey="ot_hours" fill="#a7f3d0" name="OT hours" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    ),
  }

  if (!isAdmin) {
    cards.push(workerAnalyticsCard)
  }

  const notificationCount = notificationRows.filter(n => !n.is_read).length

  const activeCardContent = cards.find(card => card.id === activeCard)

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <AuthGate>
      <div className="min-h-screen bg-gradient-to-b from-white via-emerald-50 to-white text-gray-900">
        <header className="bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">Rail Rolls</p>
              <h1 className="mt-2 text-3xl font-semibold text-gray-900">{title}</h1>
              <p className="text-sm text-gray-500">
                Welcome back, {profile?.name ?? 'team lead'}. Keep your outlet running smoothly.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {!isAdmin ? (
                <button
                  type="button"
                  className="relative rounded-full bg-emerald-50 p-3 text-emerald-600 shadow ring-1 ring-emerald-100"
                  onClick={() => setNotificationPanelOpen(prev => !prev)}
                  aria-label="Open notifications"
                >
                  🔔
                  {notificationCount ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                      {notificationCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <button
                onClick={signOut}
                className="rounded-full bg-gray-900/90 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-gray-900"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 pb-16">
          <section className="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">This week</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{summary.weeklyHours.toFixed(1)} hrs</p>
              <p className="text-sm text-gray-500">Hours tracked</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">This month</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{summary.monthlyHours.toFixed(1)} hrs</p>
              <p className="text-sm text-gray-500">Hours tracked</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Workers</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{workers.length}</p>
              <p className="text-sm text-gray-500">Active profiles</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
                {isAdmin ? 'Focus' : 'My outlet'}
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{managerOutletName}</p>
              <p className="text-sm text-gray-500">
                {isAdmin ? 'Monitoring every location' : 'Requests & attendance use this outlet'}
              </p>
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cards.map(card => (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveCard(card.id)}
                className="group rounded-3xl border border-emerald-50 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className={`inline-flex rounded-full bg-gradient-to-r ${card.accent} px-3 py-1 text-xs font-semibold text-white`}>
                  {card.title}
                </div>
                <p className="mt-3 text-sm text-gray-500">{card.description}</p>
                <div className="mt-6 flex items-end justify-between">
                  <p className="text-3xl font-bold text-gray-900">{card.stat}</p>
                  <p className="text-sm text-gray-500">{card.detail}</p>
                </div>
                <p className="mt-4 text-sm font-semibold text-emerald-600">Open panel →</p>
              </button>
            ))}
          </section>
        </main>

        <Modal
          open={Boolean(activeCardContent)}
          onClose={() => setActiveCard(null)}
          title={activeCardContent?.title}
          description={activeCardContent?.description}
          wide
        >
          {activeCardContent?.content}
        </Modal>

        <Modal
          open={Boolean(currentAppeal)}
          onClose={closeAppealModal}
          title={currentAppeal ? currentAppeal.worker_name ?? 'Worker' : 'Review appeal'}
          description={currentAppeal ? `Filed ${formatDateTime(currentAppeal.created_at)}` : undefined}
          wide={false}
        >
          {currentAppeal ? (
            <form action={respondToAppealAction} className="space-y-4">
              <input type="hidden" name="appeal_id" value={currentAppeal.id} />
              <input type="hidden" name="decision" value={appealDecision} />
              <div className="rounded-2xl bg-emerald-50/80 px-4 py-3 text-sm text-gray-600">
                <p className="font-semibold text-gray-900">Worker reason</p>
                <p className="mt-1">{currentAppeal.reason}</p>
              </div>
              <textarea
                name="response"
                value={appealResponse}
                onChange={e => setAppealResponse(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Optional response to worker"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  onClick={() => handleDecisionSelect('approve')}
                  disabled={appealActionPending}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow ${appealActionPending ? 'cursor-not-allowed bg-emerald-400 opacity-80' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                >
                  {appealActionPending && appealDecision === 'approve' ? 'Approving...' : 'Approve'}
                </button>
                <button
                  type="submit"
                  onClick={() => handleDecisionSelect('reject')}
                  disabled={appealActionPending}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-red-700 shadow ${appealActionPending ? 'cursor-not-allowed bg-red-100 opacity-80' : 'bg-red-50 hover:bg-red-100'
                    }`}
                >
                  {appealActionPending && appealDecision === 'reject' ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
              {appealActionState.status === 'error' && appealActionState.message ? (
                <p className="text-xs text-red-500">{appealActionState.message}</p>
              ) : null}
            </form>
          ) : null}
        </Modal>

        <Modal
          open={documentsModal.open}
          onClose={() => setDocumentsModal({ open: false, workerId: '' })}
          title="Worker documents"
          description="Download submitted files."
          wide={false}
        >
          {documentsLoading ? (
            <p className="text-sm text-gray-500">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents uploaded yet.</p>
          ) : (
            <div className="space-y-3">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{doc.original_name}</p>
                    <p className="text-xs text-gray-500">
                      {doc.kind} · {new Date(doc.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  {doc.signedUrl ? (
                    <a
                      href={doc.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Modal>

        {notificationPanelOpen ? (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
            <div className="relative w-full max-w-sm bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Notifications</p>
                  <p className="text-xs text-gray-500">Latest updates</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNotificationPanelOpen(false)}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
                {notificationRows.length === 0 ? (
                  <p className="text-sm text-gray-500">No notifications yet.</p>
                ) : (
                  notificationRows.map(notification => (
                    <div
                      key={notification.id}
                      className={`rounded-2xl border px-4 py-3 ${notification.is_read ? 'border-gray-100 bg-white' : 'border-emerald-100 bg-emerald-50'
                        }`}
                    >
                      <p className="text-sm font-semibold">{notification.title}</p>
                      {notification.body ? (
                        <p className="text-xs text-gray-600">{notification.body}</p>
                      ) : null}
                      <p className="text-[11px] text-gray-500">{formatDateTime(notification.created_at)}</p>
                      {!notification.is_read ? (
                        <form action={markNotificationAction} className="mt-2">
                          <input type="hidden" name="notification_id" value={notification.id} />
                          <button type="submit" className="text-xs font-semibold text-emerald-600">
                            Mark as read
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AuthGate>
  )
}
