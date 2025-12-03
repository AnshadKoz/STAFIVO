'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/serviceClient'

export type ActionResult = {
  status: 'success' | 'error'
  message?: string
}

const success = (message?: string): ActionResult => ({ status: 'success', message })
const failure = (message?: string): ActionResult => ({ status: 'error', message })

export async function saveOutletAction(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const outletId = (formData.get('outlet_id') as string | null) ?? null
  const name = (formData.get('name') as string | null)?.trim()
  const latitude = formData.get('latitude') ? Number(formData.get('latitude')) : null
  const longitude = formData.get('longitude') ? Number(formData.get('longitude')) : null
  const radius = formData.get('radius_meters') ? Number(formData.get('radius_meters')) : null

  if (!name) return failure('Outlet name is required')

  const payload = {
    name,
    latitude,
    longitude,
    radius_meters: radius,
  }

  const query = outletId
    ? supabase.from('outlets').update(payload).eq('id', outletId)
    : supabase.from('outlets').insert(payload)

  const { error } = await query

  if (error) {
    console.error('[saveOutletAction] Failed to persist outlet', error.message)
    return failure(error.message)
  }

  revalidatePath('/admin')
  return success(outletId ? 'Outlet updated' : 'Outlet created')
}

export async function deleteOutletAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const outletId = formData.get('outlet_id') as string | null
  if (!outletId) return failure('Missing outlet id')

  const { error } = await supabase.from('outlets').delete().eq('id', outletId)
  if (error) {
    console.error('[deleteOutletAction] Failed to delete outlet', error.message)
    return failure(error.message)
  }

  revalidatePath('/admin')
  return success('Outlet deleted')
}

export async function createManagerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const mode = (formData.get('mode') as string) || 'existing'
  const outlet_id = formData.get('outlet_id') as string | null
  const is_active = formData.get('is_active') === 'on'

  if (!outlet_id) return failure('Outlet is required')

  let appUserId = (formData.get('app_user_id') as string | null) ?? null

  if (mode === 'new') {
    const email = (formData.get('email') as string | null)?.trim()
    const name = (formData.get('name') as string | null)?.trim()

    if (!email) return failure('Email is required')
    if (!name) return failure('Name is required')

    try {
      const service = createServiceClient()
      const { data, error } = await service.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name },
      })
      if (error || !data.user) {
        console.error('[createManagerAction] Failed to create auth user', error?.message)
        return failure(error?.message ?? 'Unable to create auth user')
      }
      appUserId = data.user.id

      const { error: insertError } = await supabase.from('app_users').insert([
        {
          id: appUserId,
          email,
          name,
          role: 'manager',
          outlet_id,
        },
      ])

      if (insertError) {
        console.error('[createManagerAction] Failed to insert app_user', insertError.message)
        return failure(insertError.message)
      }
    } catch (err) {
      console.error('[createManagerAction] Missing service role', err)
      return failure('Service role key missing. Cannot create new manager user.')
    }
  }

  if (!appUserId) return failure('Select a manager user')

  const { error: roleError } = await supabase
    .from('app_users')
    .update({ role: 'manager', outlet_id })
    .eq('id', appUserId)

  if (roleError) {
    console.error('[createManagerAction] Failed to update app_user', roleError.message)
    return failure(roleError.message)
  }

  const { error: managerUpsertError } = await supabase
    .from('managers')
    .upsert(
      {
        app_user_id: appUserId,
        outlet_id,
        is_active,
      },
      { onConflict: 'app_user_id' }
    )

  if (managerUpsertError) {
    console.error('[createManagerAction] Failed to upsert manager', managerUpsertError.message)
    return failure(managerUpsertError.message)
  }

  revalidatePath('/admin')
  return success('Manager saved')
}

export async function updateManagerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const managerId = formData.get('manager_id') as string | null
  const outletId = formData.get('outlet_id') as string | null
  const isActive = formData.get('is_active') === 'on'
  const appUserId = formData.get('app_user_id') as string | null

  if (!managerId || !outletId || !appUserId) return failure('Missing manager data')

  const { error: managerUpdateError } = await supabase
    .from('managers')
    .update({ outlet_id: outletId, is_active: isActive })
    .eq('id', managerId)

  if (managerUpdateError) {
    console.error('[updateManagerAction] Failed to update manager', managerUpdateError.message)
    return failure(managerUpdateError.message)
  }

  const { error: appUserUpdateError } = await supabase
    .from('app_users')
    .update({ outlet_id: outletId })
    .eq('id', appUserId)

  if (appUserUpdateError) {
    console.error('[updateManagerAction] Failed to sync app_user outlet', appUserUpdateError.message)
    return failure(appUserUpdateError.message)
  }

  revalidatePath('/admin')
  return success('Manager updated')
}

export async function approveWorkerRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const requestId = formData.get('request_id') as string | null
  const adminComment = (formData.get('admin_comment') as string | null)?.trim() ?? null

  if (!requestId) return failure('Missing request id')

  const { data: request, error: requestError } = await supabase
    .from('worker_onboarding_requests')
    .select(
      'id,name,phone,email,base_salary_per_hour,ot_rate_per_hour,outlet_id,status,requested_by'
    )
    .eq('id', requestId)
    .single()

  if (requestError || !request) {
    console.error('[approveWorkerRequestAction] Missing request', requestError?.message)
    return failure(requestError?.message ?? 'Request not found')
  }

  if (request.status !== 'pending') {
    return failure('Request already processed')
  }

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .insert([
      {
        name: request.name,
        phone: request.phone,
        email: request.email,
        outlet_id: request.outlet_id,
        base_salary_per_hour: request.base_salary_per_hour,
        ot_rate_per_hour: request.ot_rate_per_hour,
      },
    ])
    .select('id')
    .single()

  if (workerError || !worker) {
    console.error('[approveWorkerRequestAction] Failed to create worker', workerError?.message)
    return failure(workerError?.message ?? 'Unable to create worker')
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('worker_onboarding_requests')
    .update({
      status: 'approved',
      approved_worker_id: worker.id,
      decided_at: now,
      admin_comment: adminComment,
    })
    .eq('id', requestId)

  if (updateError) {
    console.error('[approveWorkerRequestAction] Failed to update request', updateError.message)
    return failure(updateError.message)
  }

  const { error: notifyError } = await supabase.from('notifications').insert([
    {
      user_id: request.requested_by,
      type: 'worker_request_approved',
      title: 'Worker request approved',
      body: `Worker ${request.name} has been onboarded.`,
      data: {
        request_id: requestId,
        worker_id: worker.id,
      },
      is_read: false,
    },
  ])

  if (notifyError) {
    console.error('[approveWorkerRequestAction] Failed to notify manager', notifyError.message)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success('Worker approved')
}

export async function rejectWorkerRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const requestId = formData.get('request_id') as string | null
  const adminComment = (formData.get('admin_comment') as string | null)?.trim()

  if (!requestId) return failure('Missing request id')
  if (!adminComment) return failure('Comment is required for rejection')

  const { data: request, error: requestError } = await supabase
    .from('worker_onboarding_requests')
    .select('requested_by,status,name')
    .eq('id', requestId)
    .single()

  if (requestError || !request) {
    console.error('[rejectWorkerRequestAction] Missing request', requestError?.message)
    return failure(requestError?.message ?? 'Request not found')
  }

  if (request.status !== 'pending') {
    return failure('Request already processed')
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('worker_onboarding_requests')
    .update({
      status: 'rejected',
      decided_at: now,
      admin_comment: adminComment,
    })
    .eq('id', requestId)

  if (updateError) {
    console.error('[rejectWorkerRequestAction] Failed to update request', updateError.message)
    return failure(updateError.message)
  }

  const { error: notifyError } = await supabase.from('notifications').insert([
    {
      user_id: request.requested_by,
      type: 'worker_request_rejected',
      title: 'Worker request rejected',
      body: adminComment,
      data: {
        request_id: requestId,
        reason: adminComment,
        worker_name: request.name,
      },
      is_read: false,
    },
  ])

  if (notifyError) {
    console.error('[rejectWorkerRequestAction] Failed to notify manager', notifyError.message)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success('Worker request rejected')
}

export async function logAdminAttendanceAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
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
    console.error('[logAdminAttendanceAction] Worker lookup failed', workerError?.message)
    return failure(workerError?.message ?? 'Worker not found')
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
  }

  if (timestampUtc) {
    payload.timestamp_utc = timestampUtc
  }

  const { error } = await supabase.from('attendance_logs').insert([payload])
  if (error) {
    console.error('[logAdminAttendanceAction] Failed to insert attendance', error.message)
    return failure(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success('Attendance saved')
}

export async function createWorkerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  // Use service client to bypass RLS for admin actions
  const supabase = createServiceClient()

  const name = (formData.get('name') as string | null)?.trim()
  const phone = (formData.get('phone') as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()
  const outletId = formData.get('outlet_id') as string | null
  const baseSalary = formData.get('base_salary_per_hour') ? Number(formData.get('base_salary_per_hour')) : null
  const otRate = formData.get('ot_rate_per_hour') ? Number(formData.get('ot_rate_per_hour')) : null

  if (!name) return failure('Name is required')

  // Get current user for created_by field
  const regularClient = await createClient()
  const {
    data: { user },
  } = await regularClient.auth.getUser()

  let creatorAppUserId: string | null = null
  if (user) {
    const { data: appUser } = await regularClient
      .from('app_users')
      .select('id')
      .eq('auth_id', user.id)
      .single()
    creatorAppUserId = appUser?.id ?? null
  }

  const { error } = await supabase.from('workers').insert([
    {
      name,
      phone: phone || null,
      email: email || null,
      outlet_id: outletId || null,
      base_salary_per_hour: baseSalary,
      ot_rate_per_hour: otRate,
      created_by: creatorAppUserId,
    },
  ])

  if (error) {
    console.error('[createWorkerAction] Failed to create worker', error.message)
    return failure(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success('Worker created')
}
