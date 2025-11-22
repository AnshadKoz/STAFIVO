'use server'

import { createClient } from '@/utils/supabase/server'

export type PayrollRunRow = {
  workerId: string
  workerName: string
  outletName: string | null
  payrollMonth: string // 'YYYY-MM'
  workedHours: number
  baseSalary: number | null
  overtime: number | null
  incentives: number | null
  fines: number | null
  total: number | null
}

export type PayrollGenerationState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  month?: string
  rows?: PayrollRunRow[]
}

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

export type PayrollSlipState = {
  status: 'idle' | 'success' | 'error' | 'not_found'
  message?: string
  slip?: PayrollSlip
}

// Generate payroll records for all workers for a given month ('YYYY-MM')
export async function generatePayrollForMonthAction(
  _prevState: PayrollGenerationState,
  formData: FormData
): Promise<PayrollGenerationState> {
  const supabase = await createClient()

  const month = formData.get('month') as string | null // 'YYYY-MM'
  if (!month) {
    return { status: 'error', message: 'Missing payroll month' }
  }

  // Our SQL function expects a full date; use the 1st of the month.
  const monthDate = `${month}-01`

  const { error } = await supabase.rpc('generate_payroll_for_month', {
    p_month: monthDate,
  })

  if (error) {
    console.error('Payroll generation failed', error.message)
    return { status: 'error', message: error.message }
  }

  const monthKey = month
  const { data: payrollRows, error: payrollRowsError } = await supabase
    .from('payroll_records')
    .select('worker_id,payroll_month,base_salary,overtime,incentives,fines,calculated_total')
    .eq('payroll_month', monthKey)

  if (payrollRowsError) {
    console.error('Failed to load payroll rows', payrollRowsError.message)
    return { status: 'error', message: payrollRowsError.message }
  }

  const workerIds = Array.from(
    new Set(
      (payrollRows ?? [])
        .map(row => row.worker_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  )

  const workerMap = new Map<
    string,
    { name: string | null; outlet_id: string | null }
  >()
  const outletMap = new Map<string, string>()

  if (workerIds.length > 0) {
    const { data: workers, error: workersError } = await supabase
      .from('workers')
      .select('id,name,outlet_id,base_salary_per_hour,ot_rate_per_hour')
      .in('id', workerIds)

    if (workersError) {
      console.error('Failed to load workers', workersError.message)
      return { status: 'error', message: workersError.message }
    }

    workers?.forEach(worker => {
      workerMap.set(worker.id, { name: worker.name, outlet_id: worker.outlet_id })
    })

    const outletIds = Array.from(
      new Set((workers ?? []).map(worker => worker.outlet_id).filter((id): id is string => !!id))
    )

    if (outletIds.length > 0) {
      const { data: outlets, error: outletsError } = await supabase
        .from('outlets')
        .select('id,name')
        .in('id', outletIds)

      if (outletsError) {
        console.error('Failed to load outlets', outletsError.message)
        return { status: 'error', message: outletsError.message }
      }

      outlets?.forEach(outlet => {
        outletMap.set(outlet.id, outlet.name ?? '')
      })
    }
  }

  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
    return { status: 'error', message: 'Invalid month format' }
  }

  const monthStart = new Date(Date.UTC(year, monthIndex, 1))
  const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1))
  const monthStartISO = monthStart.toISOString().slice(0, 10)
  const nextMonthISO = nextMonthStart.toISOString().slice(0, 10)

  const hoursMap = new Map<string, number>()

  if (workerIds.length > 0) {
    const { data: hoursRows, error: hoursError } = await supabase
      .from('worker_daily_hours')
      .select('worker_id,hours_worked')
      .in('worker_id', workerIds)
      .gte('work_date', monthStartISO)
      .lt('work_date', nextMonthISO)

    if (hoursError) {
      console.error('Failed to load hours', hoursError.message)
      return { status: 'error', message: hoursError.message }
    }

    hoursRows?.forEach(row => {
      if (!row.worker_id) return
      const current = hoursMap.get(row.worker_id) ?? 0
      hoursMap.set(row.worker_id, current + (row.hours_worked ?? 0))
    })
  }

  const payrollRunRows: PayrollRunRow[] = (payrollRows ?? []).map(row => {
    const workerInfo = row.worker_id ? workerMap.get(row.worker_id) : undefined
    const outletName = workerInfo?.outlet_id ? outletMap.get(workerInfo.outlet_id) ?? null : null

    return {
      workerId: row.worker_id,
      workerName: workerInfo?.name ?? 'Worker',
      outletName,
      payrollMonth: row.payroll_month,
      workedHours: Number(hoursMap.get(row.worker_id) ?? 0),
      baseSalary: row.base_salary,
      overtime: row.overtime,
      incentives: row.incentives,
      fines: row.fines,
      total: row.calculated_total,
    }
  })

  return {
    status: 'success',
    message: `Payroll generated for ${month}`,
    month: monthKey,
    rows: payrollRunRows,
  }
}

// Fetch a single worker's payslip + worked hours for a month ('YYYY-MM')
export async function fetchPayrollSlipAction(
  _prevState: PayrollSlipState,
  formData: FormData
): Promise<PayrollSlipState> {
  const supabase = await createClient()

  const workerId = formData.get('worker_id') as string | null
  const month = formData.get('month') as string | null // 'YYYY-MM'

  if (!workerId || !month) {
    return { status: 'error', message: 'Worker and month are required' }
  }

  // 1) Load payroll row for that worker + month.
  // In the DB, payroll_records.payroll_month is stored as text 'YYYY-MM'.
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
    return {
      status: 'not_found',
      message: 'No payroll generated for that worker/month yet.',
    }
  }

  // 2) Calculate real month start + next month start to avoid invalid dates like "2025-11-31".
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1 // JS months are 0-based

  if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
    return { status: 'error', message: 'Invalid month format' }
  }

  const monthStart = new Date(Date.UTC(year, monthIndex, 1))
  const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1))

  const monthStartISO = monthStart.toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const nextMonthISO = nextMonthStart.toISOString().slice(0, 10)

  // 3) Sum worked hours for that worker inside [monthStart, nextMonthStart).
  const { data: hourRows, error: hoursError } = await supabase
    .from('worker_daily_hours')
    .select('hours_worked, work_date')
    .eq('worker_id', workerId)
    .gte('work_date', monthStartISO)
    .lt('work_date', nextMonthISO)

  if (hoursError) {
    console.error('Hours lookup failed', hoursError.message)
    return { status: 'error', message: hoursError.message }
  }

  const workedHours =
    (hourRows ?? []).reduce(
      (sum: number, row: { hours_worked: number | null }) => sum + (row.hours_worked ?? 0),
      0
    )

  // 4) Load worker rates + outlet name.
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
      payrollMonth: payrollRow.payroll_month, // still 'YYYY-MM'
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
