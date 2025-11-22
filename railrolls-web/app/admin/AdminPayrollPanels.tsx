'use client'

import { useActionState } from 'react'
import {
  generatePayrollForMonthAction,
  fetchPayrollSlipAction,
  type PayrollSlip,
  type PayrollGenerationState,
  type PayrollRunRow,
} from './payrollActions'

type WorkerOption = { id: string; name: string; outlet_id: string | null }
type OutletOption = { id: string; name: string }

type PayrollSlipState = {
  status: 'idle' | 'success' | 'error' | 'not_found'
  message?: string
  slip?: PayrollSlip
}

type AdminPayrollPanelsProps = {
  workers: WorkerOption[]
  outlets: OutletOption[]
}

const initialPayrollGenerationState: PayrollGenerationState = { status: 'idle' }
const initialPayrollSlipState: PayrollSlipState = { status: 'idle' }

const formatCurrency = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '₹0.00'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value)
}

const formatRate = (value: number | null | undefined) => {
  if (typeof value !== 'number') return 'Not set'
  return `${formatCurrency(value)}/hr`
}

const formatMonthYear = (monthKey: string) => {
  if (!monthKey) return ''
  const date = new Date(`${monthKey}-01T00:00:00Z`)
  return date.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

const getOutletName = (outlets: OutletOption[], outletId: string | null) =>
  outlets.find(o => o.id === outletId)?.name || '—'

const PayrollRunTable = ({ rows, month }: { rows: PayrollRunRow[]; month?: string }) => (
  <div className="mt-4">
    <div
      id="payroll-run-print"
      className="mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border-0"
      style={{ pageBreakInside: 'avoid', breakAfter: 'avoid-page' }}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h3 className="text-lg font-semibold">
            Payroll run
            {month ? ` – ${formatMonthYear(month)}` : ''}
          </h3>
          <p className="text-sm text-gray-500">Summary for all workers for this month.</p>
        </div>
      </div>

      <div className="px-6 py-4">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No payroll rows for this month yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="py-2 px-2 text-left font-medium">Worker</th>
                  <th className="py-2 px-2 text-left font-medium">Outlet</th>
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
                  <tr key={row.workerId} className="border-b border-gray-100">
                    <td className="py-1.5 px-2">{row.workerName}</td>
                    <td className="py-1.5 px-2">{row.outletName ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right">{row.workedHours.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right">{formatCurrency(row.baseSalary)}</td>
                    <td className="py-1.5 px-2 text-right">{formatCurrency(row.overtime)}</td>
                    <td className="py-1.5 px-2 text-right">{formatCurrency(row.incentives)}</td>
                    <td className="py-1.5 px-2 text-right">{formatCurrency(row.fines)}</td>
                    <td className="py-1.5 px-2 text-right">{formatCurrency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  </div>
)

// Helper: print only a given section by id
function handlePrintSection(sectionId: 'payslip-print' | 'payroll-run-print') {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  html.dataset.printSection = sectionId

  // Wait a frame so CSS updates before triggering print
  requestAnimationFrame(() => {
    window.print()
    requestAnimationFrame(() => {
      delete html.dataset.printSection
    })
  })
}

const PayslipCard = ({ state }: { state: PayrollSlipState }) => {
  if (state.status === 'idle') return null

  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
        {state.message || 'Could not fetch payslip.'}
      </div>
    )
  }

  if (state.status === 'not_found') {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800">
        {state.message || 'No payroll generated for this worker/month yet.'}
      </div>
    )
  }

  const slip = state.slip
  if (!slip) return null

  return (
    <section
      id="payslip-print"
      className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white shadow-sm print:border print:border-gray-300 print:shadow-none print:mt-4"
      style={{ pageBreakInside: 'avoid', breakAfter: 'avoid-page' }}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold">Rail Rolls · Payslip</h2>
          <p className="text-sm text-gray-500">
            Payroll for {formatMonthYear(slip.payrollMonth)}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition print:hidden"
          onClick={() => handlePrintSection('payslip-print')}
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Worker</div>
            <div className="text-base font-semibold text-gray-900">{slip.workerName}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Outlet</div>
            <div className="text-base font-semibold text-gray-900">{slip.outletName || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Worked hours (month)</div>
            <div className="text-base font-semibold text-gray-900">
              {slip.worked_hours.toFixed(2)} hrs
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Base rate / hr</div>
            <div className="text-base font-semibold text-gray-900">
              {formatRate(slip.base_salary_per_hour)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">OT rate / hr</div>
            <div className="text-base font-semibold text-gray-900">
              {formatRate(slip.ot_rate_per_hour)}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-500">Base salary</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatCurrency(slip.base_salary)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-500">Overtime</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatCurrency(slip.overtime)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-500">Incentives</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatCurrency(slip.incentives)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-500">Fines / deductions</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatCurrency(slip.fines)}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="text-sm text-green-700">Final total for month</div>
          <div className="text-2xl font-bold text-green-800">
            {formatCurrency(slip.calculated_total)}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function AdminPayrollPanels({ workers, outlets }: AdminPayrollPanelsProps) {
  const [generateState, generateFormAction] = useActionState(
    generatePayrollForMonthAction,
    initialPayrollGenerationState
  )

  const [payslipState, payslipFormAction] = useActionState(
    fetchPayrollSlipAction,
    initialPayrollSlipState
  )

  return (
    <div className="space-y-8 print:px-0 print:bg-white">
      {/* Generate payroll for all workers */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-md ring-1 ring-black/5 print:shadow-none">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold">Generate Payroll</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pick a month and generate or refresh payroll records for all workers.
          </p>
        </div>
        <div className="space-y-3 px-6 py-5">
          <form action={generateFormAction} className="flex flex-wrap items-end gap-4 print:hidden">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Payroll month
              </label>
              <input
                type="month"
                name="month"
                required
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder:text-gray-400"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
            >
              Generate payroll
            </button>
          </form>

          {generateState.status === 'success' && (
            <>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <p className="text-green-700">{generateState.message}</p>
                <button
                  type="button"
                  onClick={() => handlePrintSection('payroll-run-print')}
                  className="inline-flex items-center rounded-md border border-emerald-500 px-3 py-1.5 font-medium text-emerald-600 hover:bg-emerald-50 transition print:hidden"
                >
                  Print payroll run
                </button>
              </div>
              <PayrollRunTable rows={generateState.rows ?? []} month={generateState.month} />
            </>
          )}
          {generateState.status === 'error' && (
            <p className="text-sm text-red-600">
              {generateState.message || 'Payroll generation failed.'}
            </p>
          )}
        </div>
      </section>

      {/* Payslip viewer + printable card */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-md ring-1 ring-black/5">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold">Payroll slips</h2>
          <p className="mt-1 text-sm text-gray-500">
            View payroll for a specific worker and month.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Form (hidden in print) */}
          <div className="print:hidden">
            <form action={payslipFormAction} className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Payroll month
                </label>
                <input
                  type="month"
                  name="month"
                  required
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Worker
                </label>
                <select
                  name="worker_id"
                  required
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                >
                  <option value="">Select worker</option>
                  {workers.map(worker => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name} ({getOutletName(outlets, worker.outlet_id)})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="inline-flex items-center rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 transition"
              >
                View payslip
              </button>
            </form>
          </div>

          {/* Result card (also used for printing) */}
          <PayslipCard state={payslipState} />
        </div>
      </section>
    </div>
  )
}

