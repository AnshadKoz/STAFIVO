'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/serviceClient'

export type ActionResult = {
  status: 'idle' | 'success' | 'error'
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
    const password = (formData.get('password') as string | null)?.trim()

    if (!email) return failure('Email is required')
    if (!name) return failure('Name is required')
    if (!password) return failure('Password is required for new managers')
    // Basic password strength validation
    if (password.length < 6) return failure('Password must be at least 6 characters')

    try {
      const service = createServiceClient()
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
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
          auth_id: appUserId, // Explicitly link auth_id
        },
      ])

      if (insertError) {
        console.error('[createManagerAction] Failed to insert app_user', insertError.message)
        // Cleanup: try to delete the auth user if app_user insert fails
        await service.auth.admin.deleteUser(appUserId)
        return failure(insertError.message)
      }
    } catch (err) {
      console.error('[createManagerAction] Missing service role or other error', err)
      return failure('System error. Cannot create new manager user.')
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
  const password = (formData.get('password') as string | null)?.trim()

  if (!requestId) return failure('Missing request id')
  // We'll require password for approval to ensure the worker can log in
  if (!password) return failure('Password is required to approve worker')
  if (password.length < 6) return failure('Password must be at least 6 characters')

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

  // Create Auth User
  let authUserId: string | null = null
  const service = createServiceClient()

  // Use email if present, otherwise we'd need a dummy email for Supabase Auth 
  // or use phone auth (but admin actions usually easier with email/password). 
  // The validation in createWorkerAction checks for email if passed. 
  // If email is missing, we can generate a placeholder based on phone? 
  // For now, let's assume email is preferred or we error if missing for Auth creation.
  const emailToUse = request.email || `worker_${request.phone}@railrolls.local`

  try {
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email: emailToUse,
      password: password,
      email_confirm: true,
      user_metadata: { name: request.name, phone: request.phone },
    })

    if (authError || !authData.user) {
      console.error('[approveWorkerRequestAction] Auth creation failed', authError?.message)
      return failure(`Auth creation failed: ${authError?.message}`)
    }
    authUserId = authData.user.id
  } catch (err) {
    console.error('[approveWorkerRequestAction] Service client error', err)
    return failure('Failed to create login credentials')
  }

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .insert([
      {
        name: request.name,
        phone: request.phone,
        email: emailToUse, // Ensure using the email attached to Auth
        outlet_id: request.outlet_id,
        base_salary_per_hour: request.base_salary_per_hour,
        ot_rate_per_hour: request.ot_rate_per_hour,
        auth_id: authUserId, // LINK AUTH ID
      },
    ])
    .select('id')
    .single()

  if (workerError || !worker) {
    console.error('[approveWorkerRequestAction] Failed to create worker', workerError?.message)
    // Cleanup auth user
    if (authUserId) await service.auth.admin.deleteUser(authUserId)
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
      body: `Worker ${request.name} has been onboarded. Credentials generated.`,
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

  // Insert into app_users so the worker can log in
  const { error: appUserError } = await supabase.from('app_users').insert([
    {
      id: authUserId, // Use Auth ID as app_user ID for consistency
      email: emailToUse,
      name: request.name,
      role: 'worker',
      outlet_id: request.outlet_id,
      auth_id: authUserId,
    },
  ])

  if (appUserError) {
    console.error('[approveWorkerRequestAction] Failed to create app_user for worker', appUserError.message)
    // Non-fatal? If they can't log in, it is fatal for login, but worker record exists.
    // Ideally we should transaction this or handle cleanup. 
    // For now, let's return error but note that worker was created.
    return failure(`Worker created but login setup failed: ${appUserError.message}`)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success(`Worker approved & account created (${emailToUse})`)
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
    source: 'admin', // Mark as created by admin
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
  const password = (formData.get('password') as string | null)?.trim()

  if (!name) return failure('Name is required')
  // New requirement: Password needed for direct worker creation login
  if (!password) return failure('Password is required')
  if (password.length < 6) return failure('Password must be at least 6 characters')

  // Email validation
  if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return failure('Invalid email format')
  }

  // Phone validation (Indian format example)
  if (phone && !phone.match(/^[6-9]\d{9}$/)) {
    return failure('Invalid phone number format')
  }

  // Salary validation
  if (baseSalary !== null && baseSalary < 0) {
    return failure('Salary cannot be negative')
  }

  // Create Supabase Auth User first
  let authUserId: string | null = null
  const emailToUse = email || `worker_${phone}@railrolls.local`

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: emailToUse,
      password: password,
      email_confirm: true,
      user_metadata: { name, phone },
    })
    if (authError || !authData.user) {
      console.error('[createWorkerAction] Auth creation failed', authError?.message)
      return failure(authError?.message ?? 'Auth creation failed')
    }
    authUserId = authData.user.id
  } catch (err) {
    console.error('[createWorkerAction] Service error during auth creation', err)
    return failure('System error creating login credentials')
  }

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
      email: emailToUse,
      outlet_id: outletId || null,
      base_salary_per_hour: baseSalary,
      ot_rate_per_hour: otRate,
      created_by: creatorAppUserId,
      auth_id: authUserId, // Link the auth user!
    },
  ])

  if (error) {
    console.error('[createWorkerAction] Failed to create worker', error.message)
    // Cleanup auth user
    if (authUserId) await supabase.auth.admin.deleteUser(authUserId)
    return failure(error.message)
  }

  // Insert into app_users so the worker can log in
  const { error: appUserError } = await supabase.from('app_users').insert([
    {
      id: authUserId, // Usually mapping AuthID -> AppUserID
      email: emailToUse,
      name: name,
      role: 'worker',
      outlet_id: outletId || null,
      auth_id: authUserId,
    },
  ])

  if (appUserError) {
    console.error('[createWorkerAction] Failed to create app_user for worker', appUserError.message)
    // We might want to rollback worker creation/auth creation here?
    // For now, basic error reporting.
    return failure(`Worker created but login setup failed: ${appUserError.message}`)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success(`Worker created (${emailToUse})`)
}

export async function updateWorkerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = createServiceClient()
  const workerId = formData.get('worker_id') as string | null
  const name = (formData.get('name') as string | null)?.trim()
  const outletId = formData.get('outlet_id') as string | null
  const baseSalary = formData.get('base_salary_per_hour') ? Number(formData.get('base_salary_per_hour')) : null
  const otRate = formData.get('ot_rate_per_hour') ? Number(formData.get('ot_rate_per_hour')) : null

  if (!workerId) return failure('Missing worker ID')
  if (!name) return failure('Name is required')

  // Update worker details
  const updateData: Record<string, unknown> = {
    name,
    outlet_id: outletId || null,
  }
  if (baseSalary !== null) updateData.base_salary_per_hour = baseSalary
  if (otRate !== null) updateData.ot_rate_per_hour = otRate

  const { error } = await supabase.from('workers').update(updateData).eq('id', workerId)

  if (error) {
    console.error('[updateWorkerAction] Failed to update worker', error.message)
    return failure(error.message)
  }

  // Update app_users outlet if changed
  const { data: worker } = await supabase.from('workers').select('auth_id').eq('id', workerId).single()
  if (worker?.auth_id) {
    await supabase.from('app_users').update({ outlet_id: outletId || null }).eq('id', worker.auth_id)
  }

  revalidatePath('/admin')
  revalidatePath('/manager')
  return success('Worker updated')
}

export async function resetWorkerPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const workerId = formData.get('worker_id') as string | null
  const newPassword = (formData.get('new_password') as string | null)?.trim()

  if (!workerId) return failure('Missing worker ID')
  if (!newPassword) return failure('Password is required')
  if (newPassword.length < 6) return failure('Password must be at least 6 characters')

  const supabase = createServiceClient()

  // Get worker's auth_id
  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('auth_id')
    .eq('id', workerId)
    .single()

  if (workerError || !worker?.auth_id) {
    console.error('[resetWorkerPasswordAction] Worker not found', workerError?.message)
    return failure('Worker not found')
  }

  // Update password in Supabase Auth
  const { error: authError } = await supabase.auth.admin.updateUserById(worker.auth_id, {
    password: newPassword,
  })

  if (authError) {
    console.error('[resetWorkerPasswordAction] Failed to update password', authError.message)
    return failure(authError.message)
  }

  revalidatePath('/admin')
  return success('Password reset successfully')
}

export async function resetManagerPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const appUserId = formData.get('app_user_id') as string | null
  const newPassword = (formData.get('new_password') as string | null)?.trim()

  if (!appUserId) return failure('Missing manager user ID')
  if (!newPassword) return failure('Password is required')
  if (newPassword.length < 6) return failure('Password must be at least 6 characters')

  const supabase = createServiceClient()

  // Update password in Supabase Auth (app_user_id should match auth_id for managers)
  const { error: authError } = await supabase.auth.admin.updateUserById(appUserId, {
    password: newPassword,
  })

  if (authError) {
    console.error('[resetManagerPasswordAction] Failed to update password', authError.message)
    return failure(authError.message)
  }

  revalidatePath('/admin')
  return success('Manager password reset successfully')
}
