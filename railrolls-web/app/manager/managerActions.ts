'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'

export type ManagerActionResult = {
  status: 'idle' | 'success' | 'error'
  message?: string
}

const success = (message?: string): ManagerActionResult => ({ status: 'success', message })
const failure = (message?: string): ManagerActionResult => ({ status: 'error', message })

export async function createWorkerRequestAction(
  _prev: ManagerActionResult,
  formData: FormData
): Promise<ManagerActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('Not signed in')

  const { data: profile } = await supabase
    .from('app_users')
    .select('id,outlet_id')
    .eq('id', user.id)
    .single()

  if (!profile?.outlet_id) return failure('No outlet assigned')

  const payload = {
    name: (formData.get('name') as string | null)?.trim(),
    phone: (formData.get('phone') as string | null)?.trim() || null,
    email: (formData.get('email') as string | null)?.trim() || null,
    base_salary_per_hour: formData.get('base_salary_per_hour')
      ? Number(formData.get('base_salary_per_hour'))
      : null,
    ot_rate_per_hour: formData.get('ot_rate_per_hour')
      ? Number(formData.get('ot_rate_per_hour'))
      : null,
    outlet_id: profile.outlet_id,
    requested_by: profile.id,
    status: 'pending',
  }

  if (!payload.name) return failure('Worker name is required')

  const { data: request, error } = await supabase
    .from('worker_onboarding_requests')
    .insert(payload)
    .select('id,name,outlet_id')
    .single()

  if (error || !request) {
    console.error('[createWorkerRequestAction] Failed to insert request', error?.message)
    return failure(error?.message ?? 'Unable to create request')
  }

  const { data: admins } = await supabase.from('app_users').select('id').eq('role', 'admin')
  if (admins && admins.length) {
    const notifications = admins.map(admin => ({
      user_id: admin.id,
      type: 'worker_request_created',
      title: 'New worker onboarding request',
      body: `${payload.name} needs approval`,
      data: {
        request_id: request.id,
        outlet_id: payload.outlet_id,
      },
      is_read: false,
    }))
    const { error: notifyError } = await supabase.from('notifications').insert(notifications)
    if (notifyError) {
      console.error('[createWorkerRequestAction] Failed to notify admins', notifyError.message)
    }
  }

  revalidatePath('/manager')
  revalidatePath('/admin')
  return success('Request submitted')
}

export async function markNotificationReadAction(
  _prev: ManagerActionResult,
  formData: FormData
): Promise<ManagerActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('Not signed in')

  const notificationId = formData.get('notification_id') as string | null
  if (!notificationId) return failure('Missing notification id')

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', user.id)

  if (error) {
    console.error('[markNotificationReadAction] Failed to mark notification', error.message)
    return failure(error.message)
  }

  revalidatePath('/manager')
  return success()
}

export async function resolveFineAppealAction(
  _prev: ManagerActionResult,
  formData: FormData
): Promise<ManagerActionResult> {
  const supabase = await createClient()

  const appealId = formData.get('appeal_id') as string | null
  const status = (formData.get('status') as 'approved' | 'rejected' | null) ?? null
  const response = (formData.get('manager_response') as string | null)?.trim() ?? null

  if (!appealId || !status) return failure('Missing appeal data')

  const { data: appeal, error: appealError } = await supabase
    .from('fine_appeals')
    .select('id,worker_id,manager_id,adjustment_id,status')
    .eq('id', appealId)
    .single()

  if (appealError || !appeal) {
    console.error('[resolveFineAppealAction] Missing appeal', appealError?.message)
    return failure(appealError?.message ?? 'Appeal not found')
  }

  if (appeal.status !== 'pending') {
    return failure('Appeal already resolved')
  }

  const now = new Date().toISOString()

  if (status === 'approved') {
    const { data: adjustment, error: adjustmentError } = await supabase
      .from('worker_adjustments')
      .select('id,worker_id,outlet_id,amount')
      .eq('id', appeal.adjustment_id)
      .single()

    if (adjustmentError || !adjustment) {
      console.error('[resolveFineAppealAction] Missing adjustment', adjustmentError?.message)
      return failure(adjustmentError?.message ?? 'Adjustment not found')
    }

    const compensationAmount =
      typeof adjustment.amount === 'number' ? Math.abs(adjustment.amount) : null

    const { error: insertCompError } = await supabase.from('worker_adjustments').insert([
      {
        worker_id: adjustment.worker_id,
        outlet_id: adjustment.outlet_id,
        kind: 'incentive',
        hours: null,
        amount: compensationAmount,
        note: `Fine appeal approved (adjustment ${adjustment.id})`,
        effective_date: now.slice(0, 10),
      },
    ])

    if (insertCompError) {
      console.error('[resolveFineAppealAction] Failed to insert compensation', insertCompError.message)
      return failure(insertCompError.message)
    }
  }

  const { error: updateError } = await supabase
    .from('fine_appeals')
    .update({
      status,
      manager_response: response,
      resolved_at: now,
    })
    .eq('id', appealId)

  if (updateError) {
    console.error('[resolveFineAppealAction] Failed to update appeal', updateError.message)
    return failure(updateError.message)
  }

  const { data: workerRow } = await supabase
    .from('workers')
    .select('auth_id,name')
    .eq('id', appeal.worker_id)
    .single()

  if (workerRow?.auth_id) {
    const body =
      status === 'approved'
        ? 'Your fine appeal has been approved and the fine has been reversed.'
        : response ?? 'Your fine appeal has been rejected.'

    const { error: notifyError } = await supabase.from('notifications').insert([
      {
        user_id: workerRow.auth_id,
        type: 'fine_appeal_resolved',
        title: `Fine appeal ${status}`,
        body,
        data: {
          appeal_id: appealId,
          worker_name: workerRow.name,
        },
        is_read: false,
      },
    ])

    if (notifyError) {
      console.error('[resolveFineAppealAction] Failed to notify worker', notifyError.message)
    }
  }

  revalidatePath('/manager')
  revalidatePath('/worker')
  return success('Appeal updated')
}

export async function respondToFineAppealAction(
  _prev: ManagerActionResult,
  formData: FormData
): Promise<ManagerActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('Not signed in')

  const { data: managerRow, error: managerError } = await supabase
    .from('managers')
    .select('id,is_active,app_user_id')
    .eq('app_user_id', user.id)
    .maybeSingle()

  if (managerError) {
    console.error('[respondToFineAppealAction] manager lookup failed', managerError.message)
    return failure('Could not verify manager profile')
  }

  if (!managerRow || !managerRow.is_active) {
    return failure('Active manager profile not found')
  }

  const appealId = formData.get('appeal_id') as string | null
  const decisionInput = formData.get('decision') as string | null
  const decision = decisionInput === 'approve' || decisionInput === 'reject' ? decisionInput : null
  const response = (formData.get('response') as string | null)?.trim() || null

  if (!appealId || !decision) {
    return failure('Missing appeal decision')
  }

  const selectColumns = `
    id,
    worker_id,
    manager_id,
    adjustment_id,
    status,
    worker:workers (
      id,
      auth_id,
      name
    ),
    adjustment:worker_adjustments (
      id,
      amount,
      note,
      worker_id
    )
  `

  const { data: appeal, error: appealError } = await supabase
    .from('fine_appeals')
    .select(selectColumns)
    .eq('id', appealId)
    .eq('manager_id', user.id)
    .eq('status', 'pending')
    .maybeSingle()

  if (appealError) {
    console.error('[respondToFineAppealAction] appeal lookup failed', appealError.message)
  }

  if (!appeal) {
    return failure('Appeal not found or already resolved')
  }

  const adjustment = (Array.isArray((appeal as any).adjustment)
    ? (appeal as any).adjustment[0]
    : (appeal as any).adjustment) as
    | { id: string; amount: number | null; note: string | null; worker_id: string }
    | null

  const worker = (Array.isArray((appeal as any).worker)
    ? (appeal as any).worker[0]
    : (appeal as any).worker) as
    | { id: string; auth_id: string | null; name: string | null }
    | null

  if (!adjustment) {
    console.error('[respondToFineAppealAction] missing linked adjustment', appeal.adjustment_id)
    return failure('Linked adjustment missing')
  }

  if (decision === 'approve' && adjustment) {
    const existingNote = adjustment.note ?? ''
    const noteAlreadyTagged = existingNote.toLowerCase().includes('removed via appeal')
    const updatedNote =
      existingNote && !noteAlreadyTagged
        ? `${existingNote} (removed via appeal)`
        : noteAlreadyTagged
          ? existingNote
          : 'Removed via appeal'
    const adjustmentUpdates: Record<string, string | number> = { amount: 0 }
    if (updatedNote) {
      adjustmentUpdates.note = updatedNote
    }

    const { error: adjustmentError } = await supabase
      .from('worker_adjustments')
      .update(adjustmentUpdates)
      .eq('id', adjustment.id)

    if (adjustmentError) {
      console.error('[respondToFineAppealAction] failed to clear fine', adjustmentError.message)
      return failure('Unable to update fine record')
    }
  }

  const now = new Date().toISOString()
  const { data: updatedAppeal, error: updateAppealError } = await supabase
    .from('fine_appeals')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      manager_response: response,
      resolved_at: now,
    })
    .eq('id', appealId)
    .eq('manager_id', user.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (updateAppealError) {
    console.error('[respondToFineAppealAction] failed to update appeal', updateAppealError.message)
    return failure('Unable to update appeal. Please try again.')
  }

  if (!updatedAppeal) {
    return failure('Appeal not found or already resolved')
  }

  const workerAuthId = worker?.auth_id ?? null
  if (workerAuthId) {
    const notificationPayload = {
      user_id: workerAuthId,
      type: decision === 'approve' ? 'fine_appeal_approved' : 'fine_appeal_rejected',
      title: decision === 'approve' ? 'Fine removed' : 'Fine appeal reviewed',
      body:
        decision === 'approve'
          ? 'Your manager approved your fine appeal. The fine has been removed.'
          : response ?? 'Your manager reviewed your fine appeal.',
      data: {
        appeal_id: appealId,
        decision,
      },
      is_read: false,
    }

    const { error: notifyError } = await supabase.from('notifications').insert([notificationPayload])
    if (notifyError) {
      console.error('[respondToFineAppealAction] notification failed', notifyError.message)
    }
  }

  revalidatePath('/manager')
  revalidatePath('/worker')
  return success(decision === 'approve' ? 'Appeal approved' : 'Appeal rejected')
}

export async function logAttendanceAction(
  _prev: ManagerActionResult,
  formData: FormData
): Promise<ManagerActionResult> {
  const supabase = await createClient()
  const workerId = formData.get('worker_id') as string | null
  const actionValue = (formData.get('action') as 'IN' | 'OUT' | null) ?? 'IN'
  const timeValue = (formData.get('time') as string | null)?.trim()

  if (!workerId) return failure('Select worker')

  const { data: workerRow, error: workerError } = await supabase
    .from('workers')
    .select('outlet_id')
    .eq('id', workerId)
    .single()

  if (workerError || !workerRow) {
    console.error('[logAttendanceAction] Worker lookup failed', workerError?.message)
    return failure(workerError?.message ?? 'Worker not found')
  }

  // Validate sequence
  const { data: lastLog } = await supabase
    .from('attendance_logs')
    .select('action')
    .eq('worker_id', workerId)
    .order('timestamp_utc', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (actionValue === 'IN' && lastLog?.action === 'IN') {
    return failure('Worker is already logged IN')
  }
  if (actionValue === 'OUT' && (!lastLog || lastLog.action === 'OUT')) {
    return failure('Worker is already logged OUT')
  }

  let timestampUtc: string | undefined
  if (timeValue) {
    const [hours, minutes] = timeValue.split(':').map(Number)
    const custom = new Date()
    custom.setHours(hours ?? 0, minutes ?? 0, 0, 0)
    timestampUtc = custom.toISOString()
  }

  const payload: Record<string, unknown> = {
    worker_id: workerId,
    outlet_id: workerRow.outlet_id,
    action: actionValue,
    source: 'manager', // Mark as created by manager
  }

  if (timestampUtc) {
    payload.timestamp_utc = timestampUtc
  }

  const { error } = await supabase.from('attendance_logs').insert([payload])
  if (error) {
    console.error('[logAttendanceAction] Failed to insert attendance', error.message)
    return failure(error.message)
  }

  revalidatePath('/manager')
  revalidatePath('/admin')
  return success('Attendance saved')
}

// Manager payroll preview - read-only, filtered by manager's outlet
export async function previewManagerPayrollAction(
  _prevState: { status: 'idle' | 'success' | 'error'; message?: string; month?: string; rows?: any[] },
  formData: FormData
): Promise<{ status: 'idle' | 'success' | 'error'; message?: string; month?: string; rows?: any[] }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { status: 'error', message: 'Not authenticated' }
  }

  // Get manager's outlet
  const { data: profile } = await supabase
    .from('app_users')
    .select('id,outlet_id')
    .eq('id', user.id)
    .single()

  if (!profile?.outlet_id) {
    return { status: 'error', message: 'No outlet assigned to manager' }
  }

  const month = formData.get('month') as string | null

  if (!month) {
    return { status: 'error', message: 'Missing payroll month' }
  }

  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
    return { status: 'error', message: 'Invalid month format' }
  }

  const monthStart = new Date(Date.UTC(year, monthIndex, 1))
  const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1))
  const monthStartISO = monthStart.toISOString().slice(0, 10)
  const nextMonthISO = nextMonthStart.toISOString().slice(0, 10)

  // 1. Fetch Workers for manager's outlet only
  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('id,name,outlet_id,base_salary_per_hour,ot_rate_per_hour')
    .eq('outlet_id', profile.outlet_id)
    .order('name')

  if (workersError || !workers) {
    return { status: 'error', message: workersError?.message || 'Failed to load workers' }
  }

  const workerIds = workers.map(w => w.id)

  if (workerIds.length === 0) {
    return { status: 'success', message: 'No workers in your outlet', month, rows: [] }
  }

  // 2. Fetch Hours
  const { data: hoursData, error: hoursError } = await supabase
    .from('worker_daily_hours')
    .select('worker_id,hours_worked')
    .gte('work_date', monthStartISO)
    .lt('work_date', nextMonthISO)
    .in('worker_id', workerIds)

  if (hoursError) {
    return { status: 'error', message: hoursError.message }
  }

  // 3. Fetch Adjustments
  const { data: adjData, error: adjError } = await supabase
    .from('worker_adjustments')
    .select('worker_id,kind,hours,amount')
    .gte('effective_date', monthStartISO)
    .lt('effective_date', nextMonthISO)
    .in('worker_id', workerIds)

  if (adjError) {
    return { status: 'error', message: adjError.message }
  }

  // 4. Fetch Outlet name
  const { data: outlet } = await supabase
    .from('outlets')
    .select('id,name')
    .eq('id', profile.outlet_id)
    .single()

  const outletName = outlet?.name || null

  // 5. Aggregate Data
  const hoursMap = new Map<string, number>()
  hoursData?.forEach(row => {
    if (row.worker_id) {
      hoursMap.set(row.worker_id, (hoursMap.get(row.worker_id) ?? 0) + (row.hours_worked ?? 0))
    }
  })

  const adjMap = new Map<string, { otHours: number, incentives: number, fines: number }>()

  adjData?.forEach(adj => {
    if (!adj.worker_id) return
    const current = adjMap.get(adj.worker_id) ?? { otHours: 0, incentives: 0, fines: 0 }

    if (adj.kind === 'ot') {
      current.otHours += (adj.hours ?? 0)
    } else if (adj.kind === 'incentive') {
      current.incentives += (adj.amount ?? 0)
    } else if (adj.kind === 'fine' || adj.kind === 'deduction') {
      current.fines += (adj.amount ?? 0)
    }
    adjMap.set(adj.worker_id, current)
  })

  // 6. Calculate Rows
  const rows = workers.map(w => {
    const totalHours = hoursMap.get(w.id) ?? 0
    const adjustments = adjMap.get(w.id) ?? { otHours: 0, incentives: 0, fines: 0 }

    const baseSalary = totalHours * (w.base_salary_per_hour ?? 0)
    const overtime = adjustments.otHours * (w.ot_rate_per_hour ?? 0)
    const incentives = adjustments.incentives
    const fines = adjustments.fines

    const total = baseSalary + overtime + incentives - fines

    return {
      workerId: w.id,
      workerName: w.name,
      outletName: outletName,
      payrollMonth: month,
      workedHours: totalHours,
      baseSalary,
      overtime,
      incentives,
      fines,
      total
    }
  })

  return {
    status: 'success',
    message: 'Preview generated (read-only)',
    month,
    rows
  }
}