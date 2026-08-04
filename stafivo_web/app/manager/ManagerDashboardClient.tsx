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
  const [deleteOutletState, deleteOutletFormAction] = useActionState(deleteOutletAction, adminActionInit)
  const [createManagerState, managerCreateAction, createManagerPending] = useActionState(createManagerAction, adminActionInit)
  const [updateManagerState, managerUpdateAction] = useActionState(updateManagerAction, adminActionInit)
  /* Auto-dismiss outlet delete message */
  const [deleteOutletMessage, setDeleteOutletMessage] = useState<string>('')

  useEffect(() => {
    if (deleteOutletState.message) {
      setDeleteOutletMessage(deleteOutletState.message)
      const timer = setTimeout(() => setDeleteOutletMessage(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [deleteOutletState.message])



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
  const title = dashboardTitle ?? (isAdmin ? 'WorkForge · Admin Dashboard' : 'WorkForge · Manager Dashboard')

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

    const { data: w } = await supabase
      .from('workers')
      .select('id,name,phone,email,outlet_id,base_salary_per_hour,ot_rate_per_hour')
      .order('name')
    setWorkers(w || [])

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
              className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
            className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
            className="rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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

      {adjustmentForm.worker_id && (
        <div className="mt-6 border-t border-gray-100 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h4 className="text-sm font-semibold text-gray-700">Previous adjustments</h4>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={adjustmentFilterDate}
                onChange={(e) => setAdjustmentFilterDate(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <select
                value={adjustmentFilterCreatedBy}
                onChange={(e) => setAdjustmentFilterCreatedBy(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
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
                    onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
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
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Password (min 6 chars)"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
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
                    onClick={() => showToast({ type: 'info', title: 'Processing', description: 'Sending request, please wait...' })}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700"
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
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                                setResettingPasswordFor({ type: 'worker', id: worker.id, appUserId: '' })
                                setNewPassword('')
                              }}
                              className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                            >
                              Reset Password
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
      accent: 'from-green-400 to-emerald-500',
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
      accent: 'from-lime-400 to-emerald-400',
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
        accent: 'from-emerald-400 to-sky-400',
        stat: pendingRequests.length.toString(),
        detail: 'Pending approvals',
        content: (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Submit new Workers through the “Add worker” form above. Every pending request shows up here until admin
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
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
              {deleteOutletMessage ? (
                <p className="text-sm text-gray-600">{deleteOutletMessage}</p>
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
                  <div className="relative">
                    <input
                      type={showManagerPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="Password (min 6 chars)"
                      minLength={6}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                disabled={createManagerPending}
                onClick={() => showToast({
                  type: 'info',
                  title: 'Processing',
                  description: managerMode === 'new' ? 'Creating manager, please wait...' : 'Linking manager, please wait...'
                })}
                className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow transition ${createManagerPending ? 'bg-emerald-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
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
                            className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
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
                  <div className="relative mt-2">
                    <input
                      type={pendingPasswordsVisible[request.id] ? 'text' : 'password'}
                      name="password"
                      placeholder="Set Password for Worker (min 6 chars)"
                      required
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
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
        <div className="mb-4 flex items-center justify-between sm:justify-start sm:gap-4">
          <div className="inline-flex rounded-full bg-emerald-50 p-1 text-xs font-semibold text-emerald-700">
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
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
            className={`inline-flex items-center justify-center rounded-full p-1.5 transition ${isPending ? 'bg-gray-100 text-gray-400' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700'
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
              <div className="flex items-center gap-4">
                <img src="/workforge-logo.png" alt="WorkForge" className="h-14 w-auto object-contain" />
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 leading-none">
                    {profile?.name ?? 'User'}
                    <span className="ml-2 rounded-full bg-emerald-100 px-3 py-0.5 text-sm font-medium text-emerald-800 align-middle">
                      {isAdmin ? 'Admin' : 'Manager'}
                    </span>
                  </h1>
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    {isAdmin ? 'Admin Console' : 'Manager Dashboard'} · {managerOutletName}
                  </p>
                </div>
              </div>
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

        {/* Edit Worker Modal */}
        <Modal
          open={editingWorker !== null}
          onClose={() => {
            setEditingWorker(null)
            setWorkerEditForm({ name: '', outlet_id: '', base_salary_per_hour: '', ot_rate_per_hour: '' })
          }}
          title="Edit Worker"
          description="Update worker details"
          wide={false}
        >
          {editingWorker && (
            <form action={updateWorkerFormAction} className="space-y-4">
              <input type="hidden" name="worker_id" value={editingWorker.id} />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  name="name"
                  value={workerEditForm.name}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, name: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Outlet</label>
                <select
                  name="outlet_id"
                  value={workerEditForm.outlet_id}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, outlet_id: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">Select outlet</option>
                  {outlets.map(outlet => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Base Rate (₹/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  name="base_salary_per_hour"
                  value={workerEditForm.base_salary_per_hour}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, base_salary_per_hour: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">OT Rate (₹/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  name="ot_rate_per_hour"
                  value={workerEditForm.ot_rate_per_hour}
                  onChange={e => setWorkerEditForm({ ...workerEditForm, ot_rate_per_hour: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorker(null)
                    setWorkerEditForm({ name: '', outlet_id: '', base_salary_per_hour: '', ot_rate_per_hour: '' })
                  }}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
              {updateWorkerState.status === 'success' && updateWorkerState.message && (
                <p className="text-sm text-green-600">{updateWorkerState.message}</p>
              )}
              {updateWorkerState.status === 'error' && updateWorkerState.message && (
                <p className="text-sm text-red-600">{updateWorkerState.message}</p>
              )}
            </form>
          )}
        </Modal>

        {/* Reset Password Modal */}
        <Modal
          open={resettingPasswordFor !== null}
          onClose={() => {
            setResettingPasswordFor(null)
            setNewPassword('')
            setShowPassword(false)
          }}
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
                    type={showPassword ? 'text' : 'password'}
                    name="new_password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Minimum 6 characters</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700"
                >
                  Reset Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResettingPasswordFor(null)
                    setNewPassword('')
                    setShowPassword(false)
                  }}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
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

        <Modal
          open={deleteConfirmation.open}
          onClose={() => setDeleteConfirmation({ id: null, open: false })}
          title="Delete adjustment?"
          description="This action cannot be undone."
          wide={false}
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={confirmDeleteAdjustment}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirmation({ id: null, open: false })}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
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

      {/* Outlet Delete Confirmation Modal */}
      {outletDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete Outlet?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{outletDeleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOutletDeleteConfirm(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <form
                action={async (formData) => {
                  await deleteOutletFormAction(formData)
                  setOutletDeleteConfirm(null)
                }}
              >
                <input type="hidden" name="outlet_id" value={outletDeleteConfirm.id} />
                <button
                  type="submit"
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
                >
                  Delete
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
    return <span className="text-xs font-medium text-emerald-600">Saved</span>
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
            Generated by WorkForge Manager Dashboard
          </div>
        </div>
      </div>
    </div>
  </div>
)
