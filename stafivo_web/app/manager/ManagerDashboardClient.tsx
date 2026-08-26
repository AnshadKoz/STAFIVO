'use client'

import { FormEvent, ReactNode, useActionState, useEffect, useRef, useState, useTransition } from 'react'
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
import { useFormStatus, createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/app/_components/ToastProvider'
import AuthGate from '../_components/AuthGate'
import {
  createWorkerRequestAction,
  markNotificationReadAction,
  respondToFineAppealAction,
  logAttendanceAction,
  previewManagerPayrollAction,
  type ManagerActionResult,
} from './managerActions'
import { type PayrollRunRow } from '../admin/payrollActions'
import {
  approveWorkerRequestAction,
  rejectWorkerRequestAction,
  saveOutletAction,
  deleteOutletAction,
  createManagerAction,
  updateManagerAction,
  logAdminAttendanceAction,
  createWorkerAction,
  updateWorkerAction,
  resetWorkerPasswordAction,
  resetManagerPasswordAction,
  deleteWorkerAction,
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
  source?: string | null
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

type AdjustmentItem = {
  id: string
  kind: 'ot' | 'fine' | 'incentive' | 'deduction'
  hours: number | null
  amount: number | null
  note: string | null
  effective_date: string
  status?: 'pending' | 'approved' | 'rejected'
  created_by?: string
  creator_role?: string
  creator_name?: string
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

const actionStateInit: ManagerActionResult = { status: 'idle' }
const adminActionInit: ActionResult = { status: 'idle' }

// Fix: Stable reference for empty arrays to prevent infinite useEffect loops
const EMPTY_ARRAY: any[] = []

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
  const resolvedInitialOutlets = initialOutlets ?? EMPTY_ARRAY
  const resolvedInitialWorkers = initialWorkers ?? EMPTY_ARRAY
  const resolvedInitialAttendance = initialAttendance ?? EMPTY_ARRAY
  const summaryWeekly = hoursSummary?.weeklyHours ?? 0
  const summaryMonthly = hoursSummary?.monthlyHours ?? 0
  const resolvedRequests = workerRequests ?? EMPTY_ARRAY
  const resolvedNotifications = notifications ?? EMPTY_ARRAY
  const resolvedAppeals = fineAppeals ?? EMPTY_ARRAY
  const resolvedManagerRows = adminManagerRows ?? EMPTY_ARRAY
  const resolvedCandidates = managerCandidates ?? EMPTY_ARRAY
  const resolvedOutletAnalytics = outletAnalytics ?? EMPTY_ARRAY
  const resolvedWorkerAnalytics = workerAnalytics ?? EMPTY_ARRAY
  const resolvedWorkerAnalyticsWeekly = workerAnalyticsWeekly ?? EMPTY_ARRAY
  const resolvedManagerOutlet = managerOutlet ?? null

  const router = useRouter()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()
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
  const [logFilterDate, setLogFilterDate] = useState('')
  const [logFilterOutlet, setLogFilterOutlet] = useState('')
  const [logFilterWorker, setLogFilterWorker] = useState('')
  const [logFilterCreatedBy, setLogFilterCreatedBy] = useState<string>('all') // 'all' | 'device' | 'manager' | 'admin' | 'worker'
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [adjustmentFilterDate, setAdjustmentFilterDate] = useState('')
  const [adjustmentFilterCreatedBy, setAdjustmentFilterCreatedBy] = useState<string>('all') // 'all' | 'admin' | 'manager'
  const [payrollWorkerFilter, setPayrollWorkerFilter] = useState('')

  const [printPreview, setPrintPreview] = useState(false)

  // Handle printing
  useEffect(() => {
    if (printPreview) {
      const timer = setTimeout(() => {
        window.print()
      }, 100)

      const onAfterPrint = () => setPrintPreview(false)
      window.addEventListener('afterprint', onAfterPrint)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('afterprint', onAfterPrint)
      }
    }
  }, [printPreview])

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    outlet_id: resolvedManagerOutlet?.id ?? initialProfile?.outlet_id ?? '',
    base_salary_per_hour: '',
    ot_rate_per_hour: '',
    password: '',
  })
  const [aForm, setAForm] = useState<{ worker_id: string; action: 'IN' | 'OUT' }>({
    worker_id: '',
    action: 'IN',
  })
  const [attendanceTime, setAttendanceTime] = useState('')
  const [adjustmentOutletFilter, setAdjustmentOutletFilter] = useState('')
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
  const [workerAdjustments, setWorkerAdjustments] = useState<AdjustmentItem[]>([])
  const [loadingAdjustments, setLoadingAdjustments] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string | null; open: boolean }>({
    id: null,
    open: false,
  })
  const [payrollPreviewState, payrollPreviewFormAction] = useActionState(
    previewManagerPayrollAction,
    { status: 'idle' as const }
  )

  // Outlet Delete Confirmation State
  const [outletDeleteConfirm, setOutletDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    if (adjustmentMessage) {
      const timer = setTimeout(() => {
        setAdjustmentMessage(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [adjustmentMessage])

  useEffect(() => {
    if (workerMessage) {
      const timer = setTimeout(() => {
        setWorkerMessage(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [workerMessage])
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
  const [workerFilterOutlet, setWorkerFilterOutlet] = useState('')
  const [attendanceOutletFilter, setAttendanceOutletFilter] = useState('')
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null)
  const [workerEditForm, setWorkerEditForm] = useState({
    name: '',
    outlet_id: '',
    base_salary_per_hour: '',
    ot_rate_per_hour: '',
  })
  // Inline password-reset state (lives inside the Edit Worker modal)
  const [pwForm, setPwForm] = useState({ newPw: '', confirmPw: '', show: false })
  const [pwResetting, setPwResetting] = useState(false)
  const [resettingPasswordFor, setResettingPasswordFor] = useState<{ type: 'worker' | 'manager'; id: string; appUserId: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [updateWorkerState, updateWorkerFormAction] = useActionState(updateWorkerAction, { status: 'idle' as const })
  const [resetPasswordState, resetPasswordFormAction] = useActionState(resetWorkerPasswordAction, { status: 'idle' as const })
  const [resetManagerPasswordState, resetManagerPasswordFormAction] = useActionState(resetManagerPasswordAction, { status: 'idle' as const })
  const appealActionInitRef = useRef(true)
  const lastAppealMetaRef = useRef<{ id: string | null; decision: 'approve' | 'reject' }>({
    id: null,
    decision: 'approve',
  })

  const [pendingPasswordsVisible, setPendingPasswordsVisible] = useState<Record<string, boolean>>({})

  const [requestState, workerRequestAction] = useActionState(createWorkerRequestAction, actionStateInit)
  const [outletState, outletAction] = useActionState(saveOutletAction, adminActionInit)
  const [deleteOutletPending, setDeleteOutletPending] = useState(false)
  const [deleteWorkerPending, setDeleteWorkerPending] = useState(false)
  const [createManagerState, managerCreateAction, createManagerPending] = useActionState(createManagerAction, adminActionInit)
  const [updateManagerState, managerUpdateAction] = useActionState(updateManagerAction, adminActionInit)

  // Worker Delete Confirmation State
  const [workerDeleteConfirm, setWorkerDeleteConfirm] = useState<{ id: string; name: string } | null>(null)

  // Auto-dismiss messages
  const [createMessageVisible, setCreateMessageVisible] = useState(false)
  const [updateMessageVisible, setUpdateMessageVisible] = useState(false)

  // Password visibility
  const [showManagerPassword, setShowManagerPassword] = useState(false)

  useEffect(() => {
    if (createManagerState.message) {
      setCreateMessageVisible(true)
      const timer = setTimeout(() => setCreateMessageVisible(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [createManagerState])

  useEffect(() => {
    if (updateManagerState.message) {
      setUpdateMessageVisible(true)
      const timer = setTimeout(() => setUpdateMessageVisible(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [updateManagerState])
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
  const title = dashboardTitle ?? (isAdmin ? 'STAFIVO · Admin Dashboard' : 'STAFIVO · Manager Dashboard')

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
        password: '',
      })
      setWorkerMessage(requestState.message)
      router.refresh()
    } else if (!isAdmin && requestState.status === 'error' && requestState.message) {
      setWorkerMessage(requestState.message)
    }
  }, [isAdmin, requestState.status, requestState.message, managerOutletId, router])

  useEffect(() => {
    if (attendanceState.message) {
      setAttendanceMessage(attendanceState.message ?? null)
      const timer = setTimeout(() => setAttendanceMessage(null), 3000)
      return () => clearTimeout(timer)
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
    // NOTE: intentionally not re-fetching `workers` from the client here.
    // Rely on server-provided `initialWorkers` (source-of-truth) to avoid
    // client-side RLS/permission inconsistencies that can temporarily
    // overwrite the state. Caller should use `router.refresh()` after
    // server actions to get fresh worker data.
  }

  const fetchLogs = async (dateFilter: string, outletFilter: string, createdByFilter: string, workerFilter: string) => {
    setLoadingLogs(true)
    let query = supabase
      .from('attendance_logs')
      .select('id, worker_id, outlet_id, action, timestamp_utc, source')
      .order('timestamp_utc', { ascending: false })

    if (dateFilter) {
      // IST is UTC+5:30.
      // We want 00:00 IST to 23:59 IST.
      const start = new Date(`${dateFilter}T00:00:00+05:30`)
      const end = new Date(`${dateFilter}T23:59:59.999+05:30`)
      query = query.gte('timestamp_utc', start.toISOString()).lte('timestamp_utc', end.toISOString())
    } else {
      query = query.limit(100)
    }

    if (outletFilter) {
      query = query.eq('outlet_id', outletFilter)
    }

    if (workerFilter) {
      query = query.eq('worker_id', workerFilter)
    }

    if (createdByFilter !== 'all') {
      if (createdByFilter === 'worker') {
        // "Worker" filter now includes logs from the app (source='device' or null) and manual worker logs
        query = query.or('source.eq.worker,source.eq.device,source.is.null')
      } else {
        query = query.eq('source', createdByFilter)
      }
    }

    const { data: logs } = await query

    const logsDecorated: AttendanceLog[] = (logs || [])
      .map(l => ({
        ...l,
        worker_name: workers.find(x => x.id === l.worker_id)?.name || '-',
        outlet_name: outlets.find(x => x.id === l.outlet_id)?.name || '-',
      }))
      .filter(l => l.worker_name !== '-')
    setAttendance(logsDecorated)
    setLoadingLogs(false)
  }

  useEffect(() => {
    fetchLogs(logFilterDate, logFilterOutlet, logFilterCreatedBy, logFilterWorker)
  }, [logFilterDate, logFilterOutlet, logFilterCreatedBy, logFilterWorker])


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
    if (form.password) formData.append('password', form.password)

    showToast({ type: 'info', title: 'Processing', description: 'Creating worker, please wait...' })
    let result
    try {
      result = await createWorkerAction(adminActionInit, formData)
    } catch (err: any) {
      console.error('[addWorker] Server action threw', err)
      setWorkerMessage(err?.message || 'Unexpected server error')
      showToast({ type: 'error', title: 'Error', description: err?.message || 'Unexpected server error' })
      return
    }

    if (result.status === 'error') {
      setWorkerMessage(result.message || 'Failed to create worker')
      showToast({ type: 'error', title: 'Create failed', description: result.message || 'Failed to create worker' })
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
      password: '',
    })
    await loadData()
    router.refresh()
  }

  const fetchAdjustments = async (workerId: string) => {
    if (!workerId || !userId) return
    setLoadingAdjustments(true)
    let query = supabase
      .from('worker_adjustments')
      .select('id,kind,hours,amount,note,effective_date,created_by, app_users!worker_adjustments_created_by_fkey(role, name)')
      .eq('worker_id', workerId)

    // Remove the created_by restriction for admins (so they see all)
    // For managers (non-admins), we might still want to restrict, BUT
    // requirements say: "Manager should never see adjustments from other outlets."
    // Since we are filtering by worker_id, and workers belong to an outlet, 
    // and presumably RLS prevents accessing data from other outlets/workers,
    // we should rely on RLS. If RLS allows managers to see any adjustment for their workers, we are good.
    // The previous code had `.eq('created_by', userId)` which hid other managers' adjustments. 
    // Requirement 1: Admin sees all. 
    // Requirement 4: Manager sees only outlet adjustments (RLS handles outlet restriction usually).

    // If we want to strictly follow "Admin sees all" and "Manager sees only outlet", 
    // relying on RLS is best. If RLS is strict, we don't need `.eq('created_by', userId)`.
    // If the user wants to see *other* managers' adjustments for the same worker (if any), then removing it is correct.
    // Given the requirement "Show ALL adjustments (Admin)... Do NOT restrict by created_by", we remove it.

    if (adjustmentFilterDate) {
      query = query.eq('effective_date', adjustmentFilterDate)
    }

    // Sort first
    query = query.order('created_at', { ascending: false })
      .limit(50)

    const { data, error } = await query

    if (error) {
      console.error('Error fetching adjustments:', error)
      setLoadingAdjustments(false)
      return
    }

    let fetchedAdjustments = (data as any[])?.map((item: any) => ({
      ...item,
      creator_role: item.app_users?.role,
      creator_name: item.app_users?.name
    })) || []

    // Filter by Created By (Application level might be safer if we can't easily join-filter)
    // Or we can try to filter if we had the UUIDs. 
    // Since we have the role now, we can filter in memory for 'admin' vs 'manager' filter.
    if (adjustmentFilterCreatedBy !== 'all') {
      fetchedAdjustments = fetchedAdjustments.filter((adj: any) => adj.creator_role === adjustmentFilterCreatedBy)
    }


    const { data: appeals } = await supabase
      .from('fine_appeals')
      .select('adjustment_id,status')
      .in('adjustment_id', fetchedAdjustments.map((x: any) => x.id))

    const appealMap = new Map<string, 'pending' | 'approved' | 'rejected'>()
    appeals?.forEach((a: any) => appealMap.set(a.adjustment_id, a.status))

    const adjustmentsWithStatus = fetchedAdjustments.map((adj: any) => ({
      ...adj,
      status: adj.kind === 'fine' ? (appealMap.get(adj.id) ?? undefined) : undefined
    }))

    setWorkerAdjustments(adjustmentsWithStatus)
    setLoadingAdjustments(false)
  }

  useEffect(() => {
    if (adjustmentForm.worker_id) {
      fetchAdjustments(adjustmentForm.worker_id)
    } else {
      setWorkerAdjustments([])
    }
  }, [adjustmentForm.worker_id, userId, adjustmentFilterDate, adjustmentFilterCreatedBy])

  // Sync state with props on router.refresh()
  useEffect(() => {
    setWorkerTrends(resolvedWorkerAnalytics)
  }, [resolvedWorkerAnalytics])

  useEffect(() => {
    setWorkerTrendsWeekly(resolvedWorkerAnalyticsWeekly)
  }, [resolvedWorkerAnalyticsWeekly])



  const handleDeleteAdjustment = (id: string) => {
    setDeleteConfirmation({ id, open: true })
  }

  const confirmDeleteAdjustment = async () => {
    const id = deleteConfirmation.id
    if (!id) return

    const { error, count } = await supabase
      .from('worker_adjustments')
      .delete({ count: 'exact' })
      .eq('id', id)

    if (error || count === 0) {
      setAdjustmentMessage({ type: 'error', text: error ? 'Failed to delete adjustment' : 'Could not delete adjustment (permission denied)' })
      setDeleteConfirmation({ id: null, open: false })
      return
    }

    setWorkerAdjustments(prev => prev.filter(item => item.id !== id))
    setAdjustmentMessage({ type: 'success', text: 'Adjustment deleted' })
    setDeleteConfirmation({ id: null, open: false })
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

    showToast({ type: 'info', title: 'Processing', description: 'Saving adjustment, please wait...' })

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
    fetchAdjustments(adjustmentForm.worker_id)
    setAdjustmentForm({ ...adjustmentForm, kind: 'ot', hours: '', amount: '', note: '', effective_date: todayISO() })
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
    await fetchLogs(logFilterDate, logFilterOutlet, logFilterCreatedBy, logFilterWorker)
    setAForm({ worker_id: '', action: 'IN' })
    setAttendanceTime('')
  }

  const renderAdjustmentsContent = () => (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={handleAdjustmentSubmit}>
        {isAdmin && (
          <div className="flex flex-col">
            <label className="text-xs font-semibold text-gray-500 mb-1">Filter by Outlet</label>
            <select
              value={adjustmentOutletFilter}
              onChange={(e) => setAdjustmentOutletFilter(e.target.value)}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Outlets</option>
              {outlets.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={adjustmentForm.worker_id}
            onChange={e => setAdjustmentForm({ ...adjustmentForm, worker_id: e.target.value })}
            className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >

            <option value="">Select worker</option>
            {(adjustmentOutletFilter
              ? workers.filter(w => w.outlet_id === adjustmentOutletFilter)
              : workers
            ).map(worker => (
              <option key={worker.id} value={worker.id}>
                {worker.name} ({resolveOutletName(worker.outlet_id)})
              </option>
            ))}
          </select>
          <select
            value={adjustmentForm.kind}
            onChange={e => handleKindChange(e.target.value as 'ot' | 'fine' | 'incentive' | 'deduction')}
            className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ot">OT</option>
            <option value="fine">Fine</option>
            <option value="incentive">Incentive</option>
            {/* Temporarily disabled - Deduction feature */}
            {/* <option value="deduction">Deduction</option> */}
          </select>
          {adjustmentForm.kind === 'ot' ? (
            <input
              type="number"
              step="0.25"
              value={adjustmentForm.hours}
              onChange={e => setAdjustmentForm({ ...adjustmentForm, hours: e.target.value })}
              placeholder="Hours"
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
              <input
              type="number"
              step="0.01"
              value={adjustmentForm.amount}
              onChange={e => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })}
                placeholder="Amount (₹)"
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}
          <input
            type="date"
            value={adjustmentForm.effective_date}
            onChange={e => setAdjustmentForm({ ...adjustmentForm, effective_date: e.target.value })}
            className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <textarea
          value={adjustmentForm.note}
          onChange={e => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
          placeholder="Note"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={savingAdjustment}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700 disabled:opacity-60"
        >
          {savingAdjustment ? 'Saving...' : 'Save adjustment'}
        </button>
        {adjustmentMessage ? (
          <p
            className={`text-sm ${adjustmentMessage.type === 'success' ? 'text-blue-600' : 'text-red-600'
              }`}
          >
            {adjustmentMessage.text}
          </p>
        ) : null}
      </form>

      {adjustmentForm.worker_id && (
        <div className="mt-6 border-t border-gray-100 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h4 className="text-sm font-semibold text-gray-700">Previous adjustments</h4>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={adjustmentFilterDate}
                onChange={(e) => setAdjustmentFilterDate(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              <select
                value={adjustmentFilterCreatedBy}
                onChange={(e) => setAdjustmentFilterCreatedBy(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Creators</option>
                <option value="admin">Created by Admin</option>
                <option value="manager">Created by Manager</option>
              </select>
              {(adjustmentFilterDate || adjustmentFilterCreatedBy !== 'all') && (
                <button
                  onClick={() => {
                    setAdjustmentFilterDate('')
                    setAdjustmentFilterCreatedBy('all')
                  }}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {loadingAdjustments ? (
            <p className="text-xs text-gray-500">Loading...</p>
          ) : workerAdjustments.length === 0 ? (
            <p className="text-xs text-gray-500">No adjustments found.</p>
          ) : (
            <div className="space-y-2">
              {workerAdjustments.map(adj => (
                <div key={adj.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold uppercase text-xs text-gray-600">{adj.kind}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-900 font-medium">
                        {adj.kind === 'ot' ? `${adj.hours} hrs` : `₹${adj.amount}`}
                      </span>
                      {/* Creator Badge */}
                      {adj.creator_role && (
                        <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${adj.creator_role === 'admin'
                          ? 'bg-purple-50 text-purple-700 border-purple-100'
                          : 'bg-blue-50 text-blue-700 border-blue-100'
                          }`}>
                          {adj.creator_role === 'admin' ? 'Created by Admin' : `Created by Manager${adj.creator_name ? ' - ' + adj.creator_name : ''}`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(adj.effective_date).toLocaleDateString('en-IN')}{adj.note ? ` · ${adj.note}` : ''}
                      {adj.status && (
                        <span className={`ml-2 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${adj.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                          adj.status === 'approved' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                          Appeal: {adj.status}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteAdjustment(adj.id)}
                    className="text-red-600 hover:text-red-700 text-xs font-semibold px-2 py-1 hover:bg-red-50 rounded"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const filteredWorkers = workerFilterOutlet
    ? workers.filter(w => w.outlet_id === workerFilterOutlet)
    : workers

  const cards: DashboardCard[] = [
    {
      id: 'workers',
      title: isAdmin ? 'Workforce' : 'My Team',
      description: 'Manage worker roster and rates.',
      accent: 'from-blue-600 to-indigo-500',
      stat: workers.length.toString(),
      detail: 'Active workers',
      content: (
        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold tracking-wide text-blue-600">Create worker</h4>
            {isAdmin ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Full name"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <select
                    value={form.outlet_id}
                    onChange={e => setForm({ ...form, outlet_id: e.target.value })}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    placeholder="Phone"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={form.base_salary_per_hour}
                    onChange={e => setForm({ ...form, base_salary_per_hour: e.target.value })}
                    placeholder="Base rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={form.ot_rate_per_hour}
                    onChange={e => setForm({ ...form, ot_rate_per_hour: e.target.value })}
                    placeholder="OT rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Password (min 6 chars)"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={addWorker}
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700"
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
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outlet</p>
                    <p className="text-sm font-semibold text-gray-900">{managerOutletName}</p>
                  </div>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    placeholder="Phone"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    name="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    name="base_salary_per_hour"
                    value={form.base_salary_per_hour}
                    onChange={e => setForm({ ...form, base_salary_per_hour: e.target.value })}
                    placeholder="Base rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    name="ot_rate_per_hour"
                    value={form.ot_rate_per_hour}
                    onChange={e => setForm({ ...form, ot_rate_per_hour: e.target.value })}
                    placeholder="OT rate (₹/hr)"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <input type="hidden" name="outlet_id" value={managerOutletId} />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    onClick={() => showToast({ type: 'info', title: 'Processing', description: 'Sending request, please wait...' })}
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700"
                  >
                    Send approval request
                  </button>
                  {workerMessage ? <span className="text-sm text-gray-600">{workerMessage}</span> : null}
                </div>
              </form>
            )}
          </div>

          <div className="flex items-center justify-between pb-3">
            <h4 className="text-sm font-semibold text-gray-700">Worker List</h4>
            {isAdmin && (
              <select
                value={workerFilterOutlet}
                onChange={e => setWorkerFilterOutlet(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All outlets</option>
                {outlets.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
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
                  {isAdmin && <th className="px-3 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="px-3 py-4 text-center text-gray-500 text-sm">
                      No workers for this outlet
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map(worker => (
                    <tr key={worker.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">{worker.name}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {worker.outletName ?? resolveOutletName(worker.outlet_id)}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{worker.phone ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{worker.email ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{formatRate(worker.base_salary_per_hour)}</td>
                      <td className="px-3 py-2 text-gray-600">{formatRate(worker.ot_rate_per_hour)}</td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingWorker(worker)
                                setWorkerEditForm({
                                  name: worker.name,
                                  outlet_id: worker.outlet_id || '',
                                  base_salary_per_hour: worker.base_salary_per_hour?.toString() || '',
                                  ot_rate_per_hour: worker.ot_rate_per_hour?.toString() || '',
                                })
                              }}
                              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setWorkerDeleteConfirm({ id: worker.id, name: worker.name })
                              }}
                              className="text-xs text-red-600 hover:text-red-700 font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
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
      accent: 'from-blue-400 to-blue-600',
      stat: attendance.length ? attendance[0].action : 'IN',
      detail: attendance.length ? `${attendance[0].worker_name ?? ''}` : 'No records',
      content: (
        <div className="space-y-6">
          <form className="grid gap-3 md:grid-cols-4 items-end" action={handleAttendanceAction}>
            {isAdmin && (
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Outlet Filter</label>
                <select
                  value={attendanceOutletFilter}
                  onChange={(e) => setAttendanceOutletFilter(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="">All Outlets</option>
                  {outlets.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">Worker</label>
              <select
                name="worker_id"
                value={aForm.worker_id}
                onChange={e => setAForm({ ...aForm, worker_id: e.target.value })}
                className="mt-1 text-sm bg-transparent focus:outline-none w-full"
                required
              >
                <option value="">Select worker</option>
                {(attendanceOutletFilter
                  ? workers.filter(w => w.outlet_id === attendanceOutletFilter)
                  : workers
                ).map(worker => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} ({resolveOutletName(worker.outlet_id)})
                  </option>
                ))}
              </select>
            </div>
            <select
              name="action"
              value={aForm.action}
              onChange={e => setAForm({ ...aForm, action: e.target.value as 'IN' | 'OUT' })}
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700"
            >
              Log attendance
            </button>
          </form>
          {attendanceMessage ? <p className="text-sm text-gray-600">{attendanceMessage}</p> : null}

          {isAdmin && (
            <div className="flex flex-wrap items-end gap-3 pt-2">
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Date</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={logFilterDate}
                    onChange={(e) => setLogFilterDate(e.target.value)}
                    className="mt-1 text-sm bg-transparent focus:outline-none"
                  />
                  {logFilterDate && (
                    <button
                      type="button"
                      onClick={() => setLogFilterDate('')}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                      title="Clear filter"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Outlet</label>
                <select
                  value={logFilterOutlet}
                  onChange={(e) => setLogFilterOutlet(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="">All Outlets</option>
                  {outlets.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Worker</label>
                <select
                  value={logFilterWorker}
                  onChange={(e) => setLogFilterWorker(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="">All Workers</option>
                  {(logFilterOutlet
                    ? workers.filter(w => w.outlet_id === logFilterOutlet)
                    : workers
                  ).map(worker => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Created by:</label>
                <select
                  value={logFilterCreatedBy}
                  onChange={(e) => setLogFilterCreatedBy(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="worker">Worker</option>
                </select>
              </div>
            </div>
          )}
          {!isAdmin && (
            <div className="flex items-end gap-3 pt-2">
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Filter Date</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={logFilterDate}
                    onChange={(e) => setLogFilterDate(e.target.value)}
                    className="mt-1 text-sm bg-transparent focus:outline-none"
                  />
                  {logFilterDate && (
                    <button
                      type="button"
                      onClick={() => setLogFilterDate('')}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                      title="Clear filter"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Worker</label>
                <select
                  value={logFilterWorker}
                  onChange={(e) => setLogFilterWorker(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="">All Workers</option>
                  {(logFilterOutlet
                    ? workers.filter(w => w.outlet_id === logFilterOutlet)
                    : workers
                  ).map(worker => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm">
                <label className="text-xs font-semibold text-gray-500">Created by:</label>
                <select
                  value={logFilterCreatedBy}
                  onChange={(e) => setLogFilterCreatedBy(e.target.value)}
                  className="mt-1 text-sm bg-transparent focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="worker">Worker</option>
                </select>
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {loadingLogs ? (
              <p className="text-sm text-gray-500 py-4 text-center">Loading logs...</p>
            ) : attendance.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No logs found.</p>
            ) : (
              attendance.map(log => {
                const source = log.source || 'device'
                const sourceBadge = source === 'device' ? null : source === 'manager' ? (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    Created by Manager
                  </span>
                ) : source === 'admin' ? (
                  <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                    Created by Admin
                  </span>
                ) : source === 'worker' ? (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Created by Worker
                  </span>
                ) : null

                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3 shadow-sm"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{log.worker_name ?? 'Worker'}</p>
                        {sourceBadge}
                      </div>
                      <p className="text-xs text-gray-500">{log.outlet_name ?? 'Outlet'} · {log.action}</p>
                    </div>
                    <p className="text-xs text-gray-500">{formatAttendanceTime(log.timestamp_utc)}</p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'adjustments',
      title: 'Adjustments',
      description: 'Insert OT, fines, incentives, or deductions.',
      accent: 'from-blue-400 to-cyan-400',
      stat: '₹',
      detail: 'Manual edits',
      content: renderAdjustmentsContent(),
    },
  ]


  const pendingRequests = requests.filter(request => request.status === 'pending')

  if (!isAdmin) {
    cards.push(
      {
        id: 'requests',
        title: 'Worker Requests',
        description: 'Send onboarding requests to Admin for approval.',
        accent: 'from-blue-400 to-sky-400',
        stat: pendingRequests.length.toString(),
        detail: 'Pending approvals',
        content: (
          <div className="space-y-4">
              <p className="text-sm text-gray-600">
              Submit new Workers through the "Add worker" form above. Every pending request shows up here until admin
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
                            ? 'bg-blue-100 text-blue-700'
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
        accent: 'from-blue-500 to-amber-400',
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
                      className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
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
                    className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                  >
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        ),
      },
      {
        id: 'payroll-preview',
        title: 'Payroll Preview',
        description: 'Preview payroll for your outlet workers (read-only).',
        accent: 'from-blue-400 to-indigo-500',
        stat: '₹',
        detail: 'Preview only',
        content: (
          <div className="space-y-4">
            <form action={payrollPreviewFormAction} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Payroll month
                </label>
                <input
                  type="month"
                  name="month"
                  required
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700"
              >
                Preview Payroll
              </button>
            </form>
            {payrollPreviewState.status === 'success' && payrollPreviewState.rows && (
              <div className="mt-4 border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800 border border-blue-200 flex-1 mr-3">
                    <strong className="font-semibold block mb-1">Preview Mode (Read-Only)</strong>
                    Payroll preview for {payrollPreviewState.month}.
                  </div>
                  <button
                    type="button"
                    onClick={() => setPrintPreview(true)}
                    className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-black transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                    </svg>
                    Print / Save PDF
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={payrollWorkerFilter}
                    onChange={(e) => setPayrollWorkerFilter(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">All Workers</option>
                    {payrollPreviewState.rows.map((row) => (
                      <option key={row.workerId} value={row.workerId}>{row.workerName}</option>
                    ))}
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="py-2 px-3 text-left font-medium">Worker</th>
                        <th className="py-2 px-3 text-right font-medium">Hours</th>
                        <th className="py-2 px-3 text-right font-medium">Base</th>
                        <th className="py-2 px-3 text-right font-medium">OT</th>
                        <th className="py-2 px-3 text-right font-medium">Incentives</th>
                        <th className="py-2 px-3 text-right font-medium">Fines</th>
                        <th className="py-2 px-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filteredRows = payrollWorkerFilter
                          ? payrollPreviewState.rows.filter(r => r.workerId === payrollWorkerFilter)
                          : payrollPreviewState.rows;

                        if (filteredRows.length === 0) {
                          return (
                            <tr>
                              <td colSpan={7} className="py-4 text-center text-gray-500 text-sm">
                                No workers match filter
                              </td>
                            </tr>
                          );
                        }

                        return filteredRows.map(row => (
                          <tr key={row.workerId} className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium">{row.workerName}</td>
                            <td className="py-2 px-3 text-right">{(row.workedHours ?? 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">₹{(row.baseSalary ?? 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">₹{(row.overtime ?? 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">₹{(row.incentives ?? 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">₹{(row.fines ?? 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-semibold">₹{(row.total ?? 0).toFixed(2)}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {printPreview && (
              <PrintPortal>
                <PayrollPrintView
                  rows={
                    payrollWorkerFilter
                      ? (payrollPreviewState.rows || []).filter(r => r.workerId === payrollWorkerFilter)
                      : (payrollPreviewState.rows || [])
                  }
                  month={payrollPreviewState.month || ''}
                />
              </PrintPortal>
            )}
            {payrollPreviewState.status === 'error' && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {payrollPreviewState.message || 'Failed to generate preview'}
              </div>
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
        accent: 'from-blue-500 to-slate-500',
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
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
                <input
                  name="latitude"
                  value={outletForm.latitude}
                  onChange={e => setOutletForm({ ...outletForm, latitude: e.target.value })}
                  placeholder="Latitude"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  name="longitude"
                  value={outletForm.longitude}
                  onChange={e => setOutletForm({ ...outletForm, longitude: e.target.value })}
                  placeholder="Longitude"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  name="radius_meters"
                  value={outletForm.radius_meters}
                  onChange={e => setOutletForm({ ...outletForm, radius_meters: e.target.value })}
                  placeholder="Radius (m)"
                  className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
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
                    <button
                      type="button"
                      onClick={() => setOutletDeleteConfirm({ id: outlet.id, name: outlet.name })}
                      className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}

            </div>
          </div>
        ),
      },
      {
        id: 'managers',
        title: 'Managers',
        description: 'Link app users to outlets and toggle access.',
        accent: 'from-blue-500 to-indigo-500',
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
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="relative">
                    <input
                      type={showManagerPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="Password (min 6 chars)"
                      minLength={6}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowManagerPassword(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showManagerPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}
              <select
                name="outlet_id"
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                disabled={createManagerPending}
                onClick={() => showToast({
                  type: 'info',
                  title: 'Processing',
                  description: managerMode === 'new' ? 'Creating manager, please wait...' : 'Linking manager, please wait...'
                })}
                className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow transition ${createManagerPending ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
              >
                {createManagerPending
                  ? managerMode === 'new'
                    ? 'Creating manager...'
                    : 'Linking user...'
                  : managerMode === 'new'
                    ? 'Create Manager'
                    : 'Link Manager'}
              </button>

              {createManagerState.message && createMessageVisible ? (
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
                  {managerRows.map(row => {
                    const formId = `manager-form-${row.id}`
                    return (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-semibold">{row.name ?? 'Manager'}</td>
                        <td className="px-3 py-2 text-gray-600">{row.email ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          <select
                            name="outlet_id"
                            form={formId}
                            value={row.outlet_id ?? ''}
                            onChange={e => {
                              setManagerRows(prev =>
                                prev.map(m => (m.id === row.id ? { ...m, outlet_id: e.target.value } : m))
                              )
                              // Trigger auto-save
                              // Use requestAnimationFrame to let state/DOM settle if needed, but direct submit usually works
                              // Safety check for form existence
                              const form = document.getElementById(formId) as HTMLFormElement | null
                              if (form) form.requestSubmit()
                            }}
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
                            name="is_active"
                            form={formId}
                            checked={row.is_active}
                            onChange={e => {
                              setManagerRows(prev =>
                                prev.map(m => (m.id === row.id ? { ...m, is_active: e.target.checked } : m))
                              )
                              const form = document.getElementById(formId) as HTMLFormElement | null
                              if (form) form.requestSubmit()
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <form id={formId} action={managerUpdateAction} className="flex items-center gap-2">
                              <input type="hidden" name="manager_id" value={row.id} />
                              <input type="hidden" name="app_user_id" value={row.app_user_id} />
                              <AutoSaveIndicator />
                            </form>
                            <button
                              type="button"
                              onClick={() => {
                                setResettingPasswordFor({ type: 'manager', id: row.id, appUserId: row.app_user_id })
                                setNewPassword('')
                              }}
                              className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                            >
                              Reset Password
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                </tbody>
              </table>
              {
                updateManagerState.message && updateMessageVisible ? (
                  <p className="mt-3 text-sm text-gray-600">{updateManagerState.message}</p>
                ) : null
              }
            </div >
          </div >
        ),
      },
      {
        id: 'pending-workers',
        title: 'Pending Workers',
        description: 'Approve or reject onboarding requests from managers.',
        accent: 'from-blue-500 to-orange-400',
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
                    className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="relative mt-2">
                    <input
                      type={pendingPasswordsVisible[request.id] ? 'text' : 'password'}
                      name="password"
                      placeholder="Set Password for Worker (min 6 chars)"
                      required
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPendingPasswordsVisible(prev => ({ ...prev, [request.id]: !prev[request.id] }))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {pendingPasswordsVisible[request.id] ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="submit"
                      formAction={approveRequestAction}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                    >
                      Approve
                    </button>
                    <button
                      type="submit"
                      formAction={rejectRequestAction}
                      formNoValidate
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
        accent: 'from-blue-600 to-slate-600',
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
    accent: 'from-blue-400 to-cyan-400',
    stat: analyticsData.reduce((sum, item) => sum + item.total_hours, 0).toFixed(1),
    detail: analyticsLabel,
    content: (
      <div>
        <div className="mb-4 flex items-center justify-between sm:justify-start sm:gap-4">
          <div className="inline-flex rounded-full bg-blue-50 p-1 text-xs font-semibold text-blue-700">
            <button
              type="button"
              onClick={() => setAnalyticsMode('month')}
              className={`rounded-full px-3 py-1 transition ${analyticsMode === 'month' ? 'bg-white shadow text-blue-700' : 'text-blue-500'
                }`}
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsMode('week')}
              className={`rounded-full px-3 py-1 transition ${analyticsMode === 'week' ? 'bg-white shadow text-blue-700' : 'text-blue-500'
                }`}
            >
              This week
            </button>
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
            className={`inline-flex items-center justify-center rounded-full p-1.5 transition ${isPending ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700'
              }`}
            title="Refresh data"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
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

  const moduleLabelStyles = [
    'bg-sky-100 text-sky-700',
    'bg-amber-100 text-amber-800',
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-rose-100 text-rose-700',
    'bg-fuchsia-100 text-fuchsia-700',
  ]

  const notificationCount = notificationRows.filter(n => !n.is_read).length

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const getNavIcon = (cardId: string) => {
    const cls = 'w-4 h-4 flex-shrink-0'
    switch (cardId) {
      case 'workers':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
      case 'attendance':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      case 'adjustments':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
      case 'requests':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>
      case 'appeals':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
      case 'documents':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
      case 'payroll-preview':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
      case 'analytics':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
      case 'managers':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
      case 'outlets':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></svg>
      case 'payroll':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      case 'pending-workers':
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
      default:
        return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
    }
  }

  const activeCardData = cards.find(c => c.id === activeCard)

  return (
    <AuthGate>
      {/* ── Global animation styles ── */}
      <style>{`
        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dashSlideRight {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes dashShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulseLive {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }
        @keyframes notifSlide {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .dash-panel   { animation: dashFadeUp 0.32s cubic-bezier(0.16,1,0.3,1) both; }
        .dash-nav     { transition: all 0.14s ease; }
        .dash-nav:hover { transform: translateX(3px); }
        .live-dot     { animation: pulseLive 2s ease-in-out infinite; }
        .notif-panel  { animation: notifSlide 0.25s cubic-bezier(0.16,1,0.3,1) both; }
        .shimmer-btn  { position: relative; overflow: hidden; }
        .shimmer-btn::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.09) 50%, transparent 60%);
          background-size: 200% 100%;
          opacity: 0; transition: opacity 0.2s;
        }
        .shimmer-btn:hover::after { opacity: 1; animation: dashShimmer 0.6s ease; }
        .stat-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .stat-card:hover { transform: translateY(-4px); }
        select, input, textarea {
          color: inherit;
        }
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ background: '#0B1628' }}>

        {/* ════════════════ SIDEBAR ════════════════ */}
        <aside
          className="w-[232px] flex-shrink-0 flex flex-col"
          style={{ background: '#0B1628', borderRight: '1px solid rgba(255,255,255,0.055)' }}
        >
          {/* Logo */}
          <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-3">
              <img
                src="/brand/stafivo-logo.png"
                alt="STAFIVO"
                className="h-11 w-auto object-contain flex-shrink-0"
                style={{ filter: 'brightness(1.15) drop-shadow(0 0 8px rgba(129,140,248,0.45))' }}
              />
              {profile?.role === 'admin' ? (
                <span className="rounded-full bg-blue-600 text-white px-3 py-1 text-xs font-semibold">Admin</span>
              ) : profile?.role === 'manager' ? (
                <span className="rounded-full bg-blue-600 text-white px-3 py-1 text-xs font-semibold">manager</span>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-[10px] font-bold tracking-[0.18em] text-emerald-400/75 uppercase">Live</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-px">
            {/* Overview */}
            <button
              type="button"
              onClick={() => setActiveCard(null)}
              className={`dash-nav w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                activeCard === null
                  ? 'bg-indigo-500/[0.15] text-indigo-300 ring-1 ring-indigo-500/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
              Overview
              {activeCard === null && <span className="ml-auto w-1 h-1 rounded-full bg-indigo-400" />}
            </button>

            {/* Section label */}
            <p className="px-3 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
              Operations
            </p>

            {/* Module nav items */}
            {cards.map(card => {
              const hasBadge = (card.id === 'pending-workers' || card.id === 'requests') && parseInt(card.stat) > 0
              const isActive = activeCard === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setActiveCard(card.id)}
                  className={`dash-nav w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                    isActive
                      ? 'bg-indigo-500/[0.15] text-indigo-300 ring-1 ring-indigo-500/25'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                  }`}
                >
                  {getNavIcon(card.id)}
                  <span className="flex-1 text-left truncate">{card.title}</span>
                  {hasBadge && (
                    <span className="flex-shrink-0 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem] text-center">
                      {card.stat}
                    </span>
                  )}
                  {isActive && !hasBadge && <span className="ml-auto w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />}
                </button>
              )
            })}
          </nav>

          {/* User footer */}
          <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                {(profile?.name ?? 'A')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-200 truncate">{profile?.name ?? 'Admin'}</p>
                <p className="text-[10px] text-slate-500 capitalize tracking-wide">{profile?.role}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all group"
              >
                <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
                <span className="text-[9px] font-semibold uppercase tracking-wider leading-none">Logout</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ════════════════ MAIN PANE ════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#F1F5F9' }}>

          {/* ── TOPBAR ── */}
          <header
            className="flex-shrink-0 flex items-center justify-between px-6 gap-6"
            style={{ height: '72px', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid #E2E8F0', boxShadow: '0 1px 8px rgba(15,23,42,0.06)' }}
          >
            {/* Logo + Breadcrumb */}
            <div className="flex items-center gap-4 min-w-0">
              {/* STAFIVO logo */}
              <img
                src="/brand/stafivo-logo.png"
                alt="STAFIVO"
                className="h-14 w-auto object-contain flex-shrink-0"
                style={{ filter: 'drop-shadow(0 1px 3px rgba(79,70,229,0.18))' }}
              />
              {/* Divider */}
              <div className="w-px h-8 bg-slate-200 flex-shrink-0" />
              {/* Breadcrumb */}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                  {isAdmin ? 'Admin Console' : 'Manager Console'}
                </p>
                <h1 className="text-base font-bold text-slate-900 leading-snug truncate">
                  {activeCard === null ? 'Dashboard Overview' : (activeCardData?.title ?? '')}
                </h1>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Live badge */}
              <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200/80 px-3.5 py-2">
                <span className="live-dot w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-emerald-700">Live</span>
              </div>

              {/* Refresh */}
              <button
                type="button"
                onClick={() => startTransition(() => router.refresh())}
                disabled={isPending}
                title="Refresh data"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className={`w-5 h-5 ${isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>

              {/* Notifications (manager only) */}
              {!isAdmin && (
                <button
                  type="button"
                  onClick={() => setNotificationPanelOpen(prev => !prev)}
                  className="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                  </svg>
                  {notificationCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white leading-none">
                      {notificationCount}
                    </span>
                  )}
                </button>
              )}

              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white">
                {(profile?.name ?? 'A')[0].toUpperCase()}
              </div>
            </div>
          </header>

          {/* ── CONTENT ── */}
          <main className="flex-1 overflow-y-auto">
            {activeCard === null ? (
              /* ════ HOME / OVERVIEW ════ */
              <div className="p-6 space-y-6 dash-panel">

                {/* Greeting */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Welcome back</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-slate-900 tracking-tight">
                    {profile?.name ?? 'Administrator'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {isAdmin ? 'Full control across all outlets and managers.' : `Managing ${managerOutletName}`}
                  </p>
                </div>

                {/* ── Stat cards ── */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                  {[
                    {
                      label: 'This Week',
                      value: summary.weeklyHours.toFixed(1),
                      unit: 'hrs',
                      sub: 'Hours tracked',
                      from: '#7C3AED', to: '#4F46E5',
                      shadow: 'rgba(99,102,241,0.35)',
                      icon: (
                        <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ),
                    },
                    {
                      label: 'This Month',
                      value: summary.monthlyHours.toFixed(1),
                      unit: 'hrs',
                      sub: 'Hours tracked',
                      from: '#0EA5E9', to: '#0284C7',
                      shadow: 'rgba(14,165,233,0.35)',
                      icon: (
                        <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                        </svg>
                      ),
                    },
                    {
                      label: 'Workforce',
                      value: workers.length.toString(),
                      unit: '',
                      sub: 'Active workers',
                      from: '#10B981', to: '#059669',
                      shadow: 'rgba(16,185,129,0.35)',
                      icon: (
                        <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                      ),
                    },
                    isAdmin
                      ? {
                        label: 'Outlets',
                        value: outlets.length.toString(),
                        unit: '',
                        sub: 'Locations',
                        from: '#F59E0B', to: '#D97706',
                        shadow: 'rgba(245,158,11,0.35)',
                        icon: (
                          <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                          </svg>
                        ),
                      }
                      : {
                        label: 'Pending',
                        value: requests.filter(r => r.status === 'pending').length.toString(),
                        unit: '',
                        sub: 'Requests',
                        from: '#F43F5E', to: '#E11D48',
                        shadow: 'rgba(244,63,94,0.35)',
                        icon: (
                          <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                        ),
                      },
                  ].map((stat, i) => (
                    <div
                      key={stat.label}
                      className="stat-card shimmer-btn relative overflow-hidden rounded-2xl p-5"
                      style={{
                        background: `linear-gradient(135deg, ${stat.from}, ${stat.to})`,
                        boxShadow: `0 8px 24px ${stat.shadow}`,
                        animationDelay: `${i * 55}ms`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">{stat.label}</p>
                          <div className="mt-3 flex items-baseline gap-1">
                            <span className="text-4xl font-extrabold text-white tracking-tight">{stat.value}</span>
                            {stat.unit && <span className="text-base font-semibold text-white/65">{stat.unit}</span>}
                          </div>
                          <p className="mt-1.5 text-xs text-white/55">{stat.sub}</p>
                        </div>
                        <div className="rounded-xl p-2.5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }}>
                          {stat.icon}
                        </div>
                      </div>
                      {/* Decorative rings */}
                      <div className="pointer-events-none absolute -bottom-5 -right-5 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                      <div className="pointer-events-none absolute -bottom-9 -right-9 w-28 h-28 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
                    </div>
                  ))}
                </div>

                {/* ── Two-column: System overview + Recent attendance ── */}
                <div className="grid gap-5 xl:grid-cols-[340px_1fr]">

                  {/* System overview */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-sm font-bold text-slate-900">System Overview</h3>
                      <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-600 uppercase tracking-wide">
                        {isAdmin ? 'Admin' : 'Manager'}
                      </span>
                    </div>
                    <div className="space-y-3.5">
                      {[
                        { label: 'Active Workers', value: workers.length, color: '#10B981', bg: '#ECFDF5' },
                        ...(isAdmin ? [
                          { label: 'Outlets', value: outlets.length, color: '#3B82F6', bg: '#EFF6FF' },
                          { label: 'Managers', value: resolvedManagerRows.length, color: '#8B5CF6', bg: '#F5F3FF' },
                          { label: 'Pending Requests', value: requests.length, color: '#F43F5E', bg: '#FFF1F2' },
                        ] : [
                          { label: 'Pending Requests', value: requests.filter(r => r.status === 'pending').length, color: '#F43F5E', bg: '#FFF1F2' },
                          { label: 'Pending Appeals', value: appeals.length, color: '#F59E0B', bg: '#FFFBEB' },
                        ]),
                      ].map(item => (
                        <div key={item.label} className="flex items-center gap-3 group">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
                            <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                          </div>
                          <span className="flex-1 text-sm text-slate-600">{item.label}</span>
                          <span className="text-sm font-extrabold text-slate-900">{item.value}</span>
                        </div>
                      ))}
                    </div>
                    {/* Quick jumps */}
                    <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveCard('workers')}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                        Workforce
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveCard('attendance')}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Attendance
                      </button>
                    </div>
                  </div>

                  {/* Recent attendance */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-slate-900">Recent Attendance</h3>
                      <button
                        type="button"
                        onClick={() => setActiveCard('attendance')}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                      >
                        View all
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" /></svg>
                      </button>
                    </div>
                    <div className="space-y-1">
                      {attendance.slice(0, 7).length === 0 ? (
                        <div className="py-8 text-center">
                          <p className="text-sm text-slate-400">No attendance logs yet</p>
                        </div>
                      ) : (
                        attendance.slice(0, 7).map((item, i) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
                            style={{ animationDelay: `${i * 35}ms` }}
                          >
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: item.action === 'IN' ? '#10B981' : '#F43F5E' }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{item.worker_name}</p>
                              <p className="text-xs text-slate-500 truncate">{item.outlet_name}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <span
                                className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold"
                                style={item.action === 'IN'
                                  ? { background: '#ECFDF5', color: '#065F46' }
                                  : { background: '#FFF1F2', color: '#9F1239' }
                                }
                              >
                                {item.action}
                              </span>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {formatAttendanceTime(item.timestamp_utc).split(',')[1]?.trim() ?? ''}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Quick Access module grid ── */}
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-3">Quick Access</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    {cards.map((card, i) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setActiveCard(card.id)}
                        className="shimmer-btn flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300 hover:shadow-md transition-all duration-200 group"
                      >
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center"
                          style={{ background: '#EEF2FF' }}
                        >
                          <div style={{ color: '#6366F1' }}>
                            {getNavIcon(card.id)}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">{card.title}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{card.detail}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

              </div>

            ) : (

              /* ════ PANEL VIEW ════ */
              <div key={activeCard} className="p-6 dash-panel">
                <div className="max-w-5xl mx-auto">

                  {/* Panel header */}
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                      <button
                        type="button"
                        onClick={() => setActiveCard(null)}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-2 group"
                      >
                        <svg className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                        Overview
                      </button>
                      <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">{activeCardData?.title}</h2>
                      <p className="text-sm text-slate-500 mt-0.5">{activeCardData?.description}</p>
                    </div>

                    {/* Stat pill */}
                    <div className="flex-shrink-0 rounded-2xl border border-indigo-100 px-4 py-2.5 text-center" style={{ background: '#EEF2FF' }}>
                      <p className="text-2xl font-extrabold text-indigo-700 leading-tight">{activeCardData?.stat}</p>
                      <p className="text-[11px] text-indigo-400 mt-0.5">{activeCardData?.detail}</p>
                    </div>
                  </div>

                  {/* Panel content */}
                  <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                    {activeCardData?.content}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ════════════════ MODALS ════════════════ */}

      {/* Appeal review modal */}
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
            <div className="rounded-2xl bg-blue-50/80 px-4 py-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-900">Worker reason</p>
              <p className="mt-1">{currentAppeal.reason}</p>
            </div>
            <textarea
              name="response"
              value={appealResponse}
              onChange={e => setAppealResponse(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Optional response to worker"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                onClick={() => handleDecisionSelect('approve')}
                disabled={appealActionPending}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow ${appealActionPending ? 'cursor-not-allowed bg-blue-400 opacity-80' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {appealActionPending && appealDecision === 'approve' ? 'Approving...' : 'Approve'}
              </button>
              <button
                type="submit"
                onClick={() => handleDecisionSelect('reject')}
                disabled={appealActionPending}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-red-700 shadow ${appealActionPending ? 'cursor-not-allowed bg-red-100 opacity-80' : 'bg-red-50 hover:bg-red-100'}`}
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

      {/* Worker documents modal */}
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
                  <p className="text-xs text-gray-500">{doc.kind} · {new Date(doc.created_at).toLocaleDateString('en-IN')}</p>
                </div>
                {doc.signedUrl ? (
                  <a href={doc.signedUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                    Download
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Edit Worker modal */}
      <Modal
        open={editingWorker !== null}
        onClose={() => {
          setEditingWorker(null)
          setWorkerEditForm({ name: '', outlet_id: '', base_salary_per_hour: '', ot_rate_per_hour: '' })
          setPwForm({ newPw: '', confirmPw: '', show: false })
        }}
        title="Edit Worker"
        description="Update worker details"
        wide={false}
      >
        {editingWorker && (
          <div className="space-y-6">
            {/* ── Worker detail fields ── */}
            <form action={updateWorkerFormAction} className="space-y-4">
              <input type="hidden" name="worker_id" value={editingWorker.id} />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text" name="name" value={workerEditForm.name}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, name: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Outlet</label>
                <select
                  name="outlet_id" value={workerEditForm.outlet_id}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, outlet_id: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select outlet</option>
                  {outlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Base Rate (₹/hr)</label>
                <input
                  type="number" step="0.01" name="base_salary_per_hour" value={workerEditForm.base_salary_per_hour}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, base_salary_per_hour: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">OT Rate (₹/hr)</label>
                <input
                  type="number" step="0.01" name="ot_rate_per_hour" value={workerEditForm.ot_rate_per_hour}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, ot_rate_per_hour: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700">Save Changes</button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorker(null)
                    setWorkerEditForm({ name: '', outlet_id: '', base_salary_per_hour: '', ot_rate_per_hour: '' })
                    setPwForm({ newPw: '', confirmPw: '', show: false })
                  }}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >Cancel</button>
              </div>
              {updateWorkerState.status === 'success' && updateWorkerState.message && <p className="text-sm text-green-600">{updateWorkerState.message}</p>}
              {updateWorkerState.status === 'error' && updateWorkerState.message && <p className="text-sm text-red-600">{updateWorkerState.message}</p>}
            </form>

            {/* ── Reset Password section ── */}
            <div className="border-t border-gray-100 pt-5">
              <p className="mb-3 text-sm font-semibold text-gray-700">Reset Password</p>
              <p className="mb-4 text-xs text-gray-400">Leave empty if you don&apos;t want to change the password.</p>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  // ── Client-side validation ──────────────────────────────
                  if (!pwForm.newPw && !pwForm.confirmPw) return        // silently skip if both empty
                  if (pwForm.newPw.length < 6) {
                    showToast({ type: 'error', title: 'Password too short', description: 'Minimum 6 characters required.' })
                    return
                  }
                  if (pwForm.newPw !== pwForm.confirmPw) {
                    showToast({ type: 'error', title: 'Passwords do not match', description: 'New password and confirmation must be identical.' })
                    return
                  }
                  // ── Call server action ──────────────────────────────────
                  setPwResetting(true)
                  const fd = new FormData()
                  fd.append('worker_id', editingWorker.id)
                  fd.append('new_password', pwForm.newPw)
                  const result = await resetWorkerPasswordAction({ status: 'idle' }, fd)
                  setPwResetting(false)
                  if (result.status === 'success') {
                    showToast({ type: 'success', title: 'Password updated', description: 'Password updated successfully.' })
                    setPwForm({ newPw: '', confirmPw: '', show: false })  // clear fields
                  } else {
                    showToast({ type: 'error', title: 'Reset failed', description: result.message ?? 'Failed to reset password.' })
                  }
                }}
              >
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">New Password</label>
                  <div className="relative">
                    <input
                      type={pwForm.show ? 'text' : 'password'}
                      value={pwForm.newPw}
                      onChange={e => setPwForm({ ...pwForm, newPw: e.target.value })}
                      placeholder="Min. 6 characters"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 pr-16 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                    <button
                      type="button"
                      onClick={() => setPwForm({ ...pwForm, show: !pwForm.show })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                    >
                      {pwForm.show ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Confirm Password</label>
                  <input
                    type={pwForm.show ? 'text' : 'password'}
                    value={pwForm.confirmPw}
                    onChange={e => setPwForm({ ...pwForm, confirmPw: e.target.value })}
                    placeholder="Repeat new password"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  {pwForm.confirmPw && pwForm.newPw !== pwForm.confirmPw && (
                    <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                  )}
                  {pwForm.confirmPw && pwForm.newPw === pwForm.confirmPw && pwForm.newPw.length >= 6 && (
                    <p className="mt-1 text-xs text-green-600">✓ Passwords match</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={pwResetting}
                  className="w-full rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pwResetting ? 'Updating…' : 'Reset Password'}
                </button>
              </form>
            </div>
          </div>
        )}
      </Modal>

      {/* Reset Password modal */}
      <Modal
        open={resettingPasswordFor !== null}
        onClose={() => { setResettingPasswordFor(null); setNewPassword(''); setShowPassword(false) }}
        title={resettingPasswordFor?.type === 'worker' ? 'Reset Worker Password' : 'Reset Manager Password'}
        description="Set a new password for this user"
        wide={false}
      >
        {resettingPasswordFor && (
          <form action={resettingPasswordFor.type === 'worker' ? resetPasswordFormAction : resetManagerPasswordFormAction} className="space-y-4">
            <input type="hidden" name={resettingPasswordFor.type === 'worker' ? 'worker_id' : 'app_user_id'} value={resettingPasswordFor.type === 'worker' ? resettingPasswordFor.id : resettingPasswordFor.appUserId} />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} name="new_password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required minLength={6}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Minimum 6 characters</p>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="flex-1 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700">Reset Password</button>
              <button
                type="button"
                onClick={() => { setResettingPasswordFor(null); setNewPassword(''); setShowPassword(false) }}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >Cancel</button>
            </div>
            {(resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).status === 'success' && (resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).message && (
              <p className="text-sm text-green-600">{(resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).message}</p>
            )}
            {(resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).status === 'error' && (resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).message && (
              <p className="text-sm text-red-600">{(resettingPasswordFor.type === 'worker' ? resetPasswordState : resetManagerPasswordState).message}</p>
            )}
          </form>
        )}
      </Modal>

      {/* Delete adjustment modal */}
      <Modal
        open={deleteConfirmation.open}
        onClose={() => setDeleteConfirmation({ id: null, open: false })}
        title="Delete adjustment?"
        description="This action cannot be undone."
        wide={false}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={confirmDeleteAdjustment} className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700">Delete</button>
          <button type="button" onClick={() => setDeleteConfirmation({ id: null, open: false })} className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
        </div>
      </Modal>

      {/* ── Notification panel ── */}
      {notificationPanelOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end" style={{ background: 'rgba(0,0,0,0.18)' }} onClick={() => setNotificationPanelOpen(false)}>
          <div
            className="relative w-full max-w-sm bg-white shadow-2xl notif-panel"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div>
                <p className="text-sm font-bold text-gray-900">Notifications</p>
                <p className="text-xs text-gray-500">Latest updates</p>
              </div>
              <button
                type="button"
                onClick={() => setNotificationPanelOpen(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
              {notificationRows.length === 0 ? (
                <p className="text-sm text-gray-500">No notifications yet.</p>
              ) : (
                notificationRows.map(notification => (
                  <div
                    key={notification.id}
                    className={`rounded-2xl border px-4 py-3 ${notification.is_read ? 'border-gray-100 bg-white' : 'border-blue-100 bg-blue-50'}`}
                  >
                    <p className="text-sm font-semibold">{notification.title}</p>
                    {notification.body ? <p className="text-xs text-gray-600">{notification.body}</p> : null}
                    <p className="text-[11px] text-gray-500">{formatDateTime(notification.created_at)}</p>
                    {!notification.is_read ? (
                      <form action={markNotificationAction} className="mt-2">
                        <input type="hidden" name="notification_id" value={notification.id} />
                        <button type="submit" className="text-xs font-semibold text-blue-600">Mark as read</button>
                      </form>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Outlet delete confirmation ── */}
      {outletDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete Outlet?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{outletDeleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <strong>{outletDeleteConfirm.name}</strong> to confirm
              </label>
              <input
                type="text" value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                placeholder={outletDeleteConfirm.name}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setOutletDeleteConfirm(null); setDeleteConfirmText('') }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <form
                action={async (formData) => {
                  setDeleteOutletPending(true)
                  const result = await deleteOutletAction(adminActionInit, formData)
                  setDeleteOutletPending(false)
                  if (result.status === 'success') {
                    showToast({ type: 'success', title: 'Success', description: 'Outlet deleted successfully' })
                    setOutletDeleteConfirm(null)
                    setDeleteConfirmText('')
                    loadData()
                    router.refresh()
                  } else {
                    showToast({ type: 'error', title: 'Error', description: result.message || 'Failed to delete outlet' })
                  }
                }}
              >
                <input type="hidden" name="outlet_id" value={outletDeleteConfirm.id} />
                <button
                  type="submit"
                  disabled={deleteConfirmText !== outletDeleteConfirm.name || deleteOutletPending}
                  className="rounded-xl bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
                >
                  {deleteOutletPending ? 'Deleting...' : 'Delete'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Worker delete confirmation ── */}
      {workerDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Remove worker permanently?</h3>
            <p className="mt-2 text-sm text-gray-600">
              This action will permanently delete the worker and all related data.
              This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setWorkerDeleteConfirm(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                disabled={deleteWorkerPending}
              >
                Cancel
              </button>
              <form action={async (formData) => {
                setDeleteWorkerPending(true)
                const result = await deleteWorkerAction(adminActionInit, formData)
                setDeleteWorkerPending(false)
                if (result.status === 'success') {
                  showToast({ type: 'success', title: 'Success', description: 'Worker removed permanently' })
                  setWorkerDeleteConfirm(null)
                  loadData()
                  router.refresh()
                } else {
                  showToast({ type: 'error', title: 'Error', description: result.message || 'Failed to remove worker' })
                }
              }}>
                <input type="hidden" name="worker_id" value={workerDeleteConfirm.id} />
                <button
                  type="submit"
                  disabled={deleteWorkerPending}
                  className="rounded-xl bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
                >
                  {deleteWorkerPending ? 'Removing...' : 'Remove'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

    </AuthGate>
  )
}

function AutoSaveIndicator() {
  const { pending } = useFormStatus()
  const [saved, setSaved] = useState(false)
  const prevPending = useRef(pending)

  useEffect(() => {
    if (prevPending.current && !pending) {
      setSaved(true)
      const timer = setTimeout(() => setSaved(false), 2000)
      return () => clearTimeout(timer)
    }
    prevPending.current = pending
  }, [pending])

  if (pending) {
    return <span className="text-xs font-medium text-gray-400">Saving...</span>
  }

  if (saved) {
    return <span className="text-xs font-medium text-blue-600">Saved</span>
  }

  return <span className="w-8" /> // Spacer
}

// Print Portal Component
const PrintPortal = ({ children }: { children: ReactNode }) => {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div id="print-portal-root">{children}</div>,
    document.body
  )
}

const PayrollPrintView = ({ rows, month }: { rows: PayrollRunRow[], month: string }) => (
  <div className="p-8 bg-white min-h-screen">
    <div className="mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white shadow-none border-0">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h3 className="text-lg font-semibold">
            Payroll Preview – {month}
          </h3>
          <p className="text-sm text-gray-500">Summary for all workers for this month.</p>
        </div>
      </div>
      <div className="px-6 py-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-white border-black">
                <th className="py-2 px-2 text-left font-medium">Worker</th>
                <th className="py-2 px-2 text-right font-medium">Worked hrs</th>
                <th className="py-2 px-2 text-right font-medium">Base salary</th>
                <th className="py-2 px-2 text-right font-medium">Overtime</th>
                <th className="py-2 px-2 text-right font-medium">Incentives</th>
                <th className="py-2 px-2 text-right font-medium">Fines</th>
                <th className="py-2 px-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.workerId} className="border-b border-gray-100 border-gray-300">
                  <td className="py-1.5 px-2 font-medium">{row.workerName}</td>
                  <td className="py-1.5 px-2 text-right">{(row.workedHours ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right">₹{(row.baseSalary ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right">₹{(row.overtime ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right">₹{(row.incentives ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right">₹{(row.fines ?? 0).toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-semibold">₹{(row.total ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
            <div className="mt-8 text-xs text-gray-500 text-center">
            Generated by STAFIVO · Powered by Pent 26
          </div>
        </div>
      </div>
    </div>
  </div>
)




