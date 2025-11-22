'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/serviceClient'

export type WorkerActionResult = {
  status: 'success' | 'error'
  message?: string
}

const success = (message?: string): WorkerActionResult => ({ status: 'success', message })
const failure = (message?: string): WorkerActionResult => ({ status: 'error', message })

export async function submitFineAppealAction(
  _prev: WorkerActionResult,
  formData: FormData
): Promise<WorkerActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('Not signed in')

  const { data: worker } = await supabase
    .from('workers')
    .select('id,outlet_id')
    .eq('auth_id', user.id)
    .single()

  if (!worker) return failure('Worker profile missing')
  if (!worker.outlet_id)
    return failure('Your worker profile is not linked to an outlet yet. Please contact your manager.')

  const adjustmentId = formData.get('adjustment_id') as string | null
  const reason = (formData.get('reason') as string | null)?.trim()

  if (!adjustmentId) return failure('Missing adjustment')
  if (!reason) return failure('Reason required')

  type ManagerRow = { id: string; outlet_id: string | null; app_user_id: string | null; is_active: boolean }
  let managerRecord: ManagerRow | null = null

  const fetchManagerForClient = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('managers')
      .select('id,outlet_id,app_user_id,is_active')
      .eq('outlet_id', worker.outlet_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[submitFineAppealAction] manager lookup failed', error.message)
      return null
    }
    return data ?? null
  }

  try {
    const serviceClient = createServiceClient()
    managerRecord = await fetchManagerForClient(serviceClient)
  } catch (serviceError) {
    console.warn('[submitFineAppealAction] Service client unavailable, falling back to anon client', serviceError)
  }

  if (!managerRecord) {
    managerRecord = await fetchManagerForClient(supabase)
  }

  if (!managerRecord) {
    return failure('No manager is assigned to your outlet yet.')
  }

  if (!managerRecord.app_user_id) {
    return failure('No manager account linked to your outlet yet.')
  }

  const { data: appeal, error } = await supabase
    .from('fine_appeals')
    .insert([
      {
        worker_id: worker.id,
        manager_id: managerRecord.app_user_id,
        adjustment_id: adjustmentId,
        reason,
        status: 'pending',
      },
    ])
    .select('id')
    .single()

  if (error || !appeal) {
    console.error('[submitFineAppealAction] Failed to file appeal', error?.message)
    return failure('Could not submit appeal. Please try again.')
  }

  const { error: notifyError } = await supabase.from('notifications').insert([
    {
      user_id: managerRecord.app_user_id,
      type: 'fine_appeal_created',
      title: 'New fine appeal',
      body: 'A worker submitted a fine appeal.',
      data: { appeal_id: appeal.id, adjustment_id: adjustmentId },
      is_read: false,
    },
  ])

  if (notifyError) {
    console.error('[submitFineAppealAction] Failed to notify manager', notifyError.message)
  }

  revalidatePath('/manager')
  revalidatePath('/worker')
  return success('Appeal submitted')
}
