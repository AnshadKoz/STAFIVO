'use server'

import { createClient } from '@/utils/supabase/server'

export type PayrollSlip = {
  workerName: string
  outletName: string | null
  payrollMonth: string // 'YYYY-MM'
  base_salary: number | null
  overtime: number | null
  incentives: number | null
  fines: number | null
  calculated_total: number | null
  base_salary_per_hour: number | null
  ot_rate_per_hour: number | null
  worked_hours: number
}

export async function generatePayrollForMonthAction(
  _prevState: { status: 'idle' | 'success' | 'error'; message?: string },
  formData: FormData
): Promise<{ status: 'idle' | 'success' | 'error'; message?: string }> {
  const supabase = await createClient()

  const month = formData.get('month') as string | null
  if (!month) {
    return { status: 'error', message: 'Missing payroll month' }
  }

  const monthDate = `${month}-01`

  const { error } = await supabase.rpc('generate_payroll_for_month', {
    p_month: monthDate,
  })

  if (error) {
    console.error('Payroll generation failed', error.message)
    return { status: 'error', message: error.message }
  }

  return { status: 'success', message: `Payroll generated for ${month}` }
}

export async function fetchPayrollSlipAction(
  _prevState: {
    status: 'idle' | 'success' | 'error' | 'not_found'
    message?: string
    slip?: PayrollSlip
  },
  formData: FormData
): Promise<{
  status: 'idle' | 'success' | 'error' | 'not_found'
  message?: string
  slip?: PayrollSlip
}> {
  const supabase = await createClient()

  const workerId = formData.get('worker_id') as string | null
  const month = formData.get('month') as string | null

  if (!workerId || !month) {
    return { status: 'error', message: 'Worker and month are required' }
  }

  const { data: payrollRow, error: payrollError } = await supabase
    .from('payroll_records')
    .select('worker_id,payroll_month,base_salary,overtime,incentives,fines,calculated_total')
    .eq('worker_id', workerId)
    .eq('payroll_month', month)
    .maybeSingle()

  if (payrollError) {
    console.error('Payroll lookup failed', payrollError.message)
    return { status: 'error', message: payrollError.message }
  }

  if (!payrollRow) {
    return { status: 'not_found', message: 'No payroll generated for that worker/month yet.' }
  }

  const { data: hourRows, error: hoursError } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked, work_date')
    .gte('work_date', `${month}-01`)
    .lte('work_date', `${month}-31`)
    .eq('worker_id', workerId)

  if (hoursError) {
    console.error('Hours lookup failed', hoursError.message)
    return { status: 'error', message: hoursError.message }
  }

  const workedHours =
    (hourRows ?? []).reduce(
      (sum: number, row: { hours_worked: number | null }) => sum + (row.hours_worked ?? 0),
      0
    )

  const { data: workerRow, error: workerError } = await supabase
    .from('workers')
    .select('name,outlet_id,base_salary_per_hour,ot_rate_per_hour')
    .eq('id', workerId)
    .single()

  if (workerError || !workerRow) {
    return { status: 'error', message: workerError?.message || 'Worker not found' }
  }

  let outletName: string | null = null
  if (workerRow.outlet_id) {
    const { data: outlet } = await supabase
      .from('outlets')
      .select('name')
      .eq('id', workerRow.outlet_id)
      .maybeSingle()
    outletName = outlet?.name ?? null
  }

  return {
    status: 'success',
    slip: {
      workerName: workerRow.name ?? 'Worker',
      outletName,
      payrollMonth: payrollRow.payroll_month,
      base_salary: payrollRow.base_salary,
      overtime: payrollRow.overtime,
      incentives: payrollRow.incentives,
      fines: payrollRow.fines,
      calculated_total: payrollRow.calculated_total,
      base_salary_per_hour: workerRow.base_salary_per_hour,
      ot_rate_per_hour: workerRow.ot_rate_per_hour,
      worked_hours: workedHours,
    },
  }
}
