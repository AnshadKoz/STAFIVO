'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  generatePayrollForMonthAction,
  previewPayrollForMonthAction,
  fetchPayrollSlipAction,
  exportPayrollStatsAction,
  fetchWorkerStatsAction,
  type PayrollSlip,
  type PayrollGenerationState,
  type PayrollRunRow,
  type ExportPayrollState,
  type WorkerStatsState,
  type WorkerStatsRow,
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
const initialPayrollPreviewState: PayrollGenerationState = { status: 'idle' }
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

const PayrollRunTable = ({
  rows,
  month,
  onPrint
}: {
  rows: PayrollRunRow[],
  month?: string,
  onPrint?: () => void
}) => (
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
        {onPrint && (
          <button
            type="button"
            onClick={onPrint}
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition print:hidden"
          >
            Print / Save as PDF
          </button>
        )}
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

import { createPortal } from 'react-dom'

// Print Portal Component
const PrintPortal = ({ children }: { children: React.ReactNode }) => {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div id="print-portal-root">{children}</div>,
    document.body
  )
}

const PayslipCard = ({ state, onPrint }: { state: PayrollSlipState, onPrint?: () => void }) => {
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
          <h2 className="text-xl font-semibold">WorkForge · Payslip</h2>
          <p className="text-sm text-gray-500">
            Payroll for {formatMonthYear(slip.payrollMonth)}
          </p>
        </div>
        {onPrint && (
          <button
            type="button"
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition print:hidden"
            onClick={onPrint}
          >
            Print / Save as PDF
          </button>
        )}
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

const WorkerStatsTable = ({ rows, onPrint }: { rows: WorkerStatsRow[], onPrint?: () => void }) => (
  <div
    id="worker-stats-print"
    className="mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border-0 mt-6"
    style={{ pageBreakInside: 'avoid', breakAfter: 'avoid-page' }}
  >
    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
      <div>
        <h3 className="text-lg font-semibold">Worker Statistics Report</h3>
        <p className="text-sm text-gray-500">
          Generated on {new Date().toLocaleDateString('en-IN')}
        </p>
      </div>
      {onPrint && (
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition print:hidden"
        >
          Print / Save PDF
        </button>
      )}
    </div>
    <div className="px-6 py-4">
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No worker data found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="py-2 px-2 text-left font-medium">Worker Name</th>
                <th className="py-2 px-2 text-left font-medium">Outlet</th>
                <th className="py-2 px-2 text-right font-medium">Wk Hours</th>
                <th className="py-2 px-2 text-right font-medium">Mo Hours</th>
                <th className="py-2 px-2 text-right font-medium">Last Payroll</th>
                <th className="py-2 px-2 text-right font-medium">Month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.workerId} className="border-b border-gray-100">
                  <td className="py-1.5 px-2 font-medium text-gray-900">{row.name}</td>
                  <td className="py-1.5 px-2 text-gray-600">{row.outletName}</td>
                  <td className="py-1.5 px-2 text-right text-gray-900">{row.weeklyHours.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right text-gray-900">{row.monthlyHours.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right text-gray-900">{formatCurrency(row.latestPayrollTotal)}</td>
                  <td className="py-1.5 px-2 text-right text-gray-600">{row.latestPayrollMonth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </div>
)

export default function AdminPayrollPanels({ workers, outlets }: AdminPayrollPanelsProps) {
  const [generateState, generateFormAction] = useActionState(
    generatePayrollForMonthAction,
    initialPayrollGenerationState
  )

  const [previewState, previewFormAction] = useActionState(
    previewPayrollForMonthAction,
    initialPayrollPreviewState
  )

  const [payslipState, payslipFormAction] = useActionState(
    fetchPayrollSlipAction,
    initialPayrollSlipState
  )

  const [exportState, exportFormAction] = useActionState(
    exportPayrollStatsAction,
    { status: 'idle' } as ExportPayrollState
  )

  useEffect(() => {
    if (exportState.status === 'success' && exportState.csv) {
      const blob = new Blob([exportState.csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportState.filename || 'payroll_export.csv'
      a.click()
      window.URL.revokeObjectURL(url)
    }
  }, [exportState])

  const [reportState, reportFormAction] = useActionState(
    fetchWorkerStatsAction,
    { status: 'idle' } as WorkerStatsState
  )

  /* Print State Management */
  const [printSection, setPrintSection] = useState<'payslip' | 'payroll-run' | 'worker-stats' | null>(null)

  const handlePrint = (section: 'payslip' | 'payroll-run' | 'worker-stats') => {
    setPrintSection(section)
  }

  // Trigger print dialog when printSection changes
  useEffect(() => {
    if (printSection) {
      const timer = setTimeout(() => {
        window.print()
      }, 100)

      const onAfterPrint = () => setPrintSection(null)
      window.addEventListener('afterprint', onAfterPrint)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('afterprint', onAfterPrint)
      }
    }
  }, [printSection])

  /* Outlet Filter State for Payslips */
  const [payslipOutletFilter, setPayslipOutletFilter] = useState<string>('')

  /* Outlet Filter for Generation */
  const [generateOutletId, setGenerateOutletId] = useState<string>('')

  const filteredWorkers = payslipOutletFilter
    ? workers.filter(w => w.outlet_id === payslipOutletFilter)
    : workers

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
          <form className="flex flex-wrap items-end gap-4 print:hidden">
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
                Outlet (Optional)
              </label>
              <select
                name="outlet_id"
                value={generateOutletId}
                onChange={(e) => setGenerateOutletId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">All outlets</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              formAction={previewFormAction}
              className="inline-flex items-center rounded-lg bg-white border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition"
            >
              Preview payroll
            </button>

            <button
              type="submit"
              formAction={generateFormAction}
              className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
            >
              Generate payroll
            </button>
          </form>

          {/* Preview Section */}
          {previewState.status === 'success' && (
            <div className="mt-6 border-t pt-4">
              <div className="mb-4 rounded-md bg-amber-50 p-4 text-sm text-amber-800 border border-amber-200">
                <strong className="font-semibold block mb-1">Preview Mode</strong>
                Calculating for: <strong>{generateOutletId ? outlets.find(o => o.id === generateOutletId)?.name : 'All Outlets'}</strong>.
                Payroll is not yet saved.
              </div>
              <h3 className="text-md font-semibold text-gray-800 mb-2">
                Preview: Pay Run for {formatMonthYear(previewState.month || '')}
                <span className="ml-2 text-gray-500 font-normal">
                  ({generateOutletId ? outlets.find(o => o.id === generateOutletId)?.name : 'All Outlets'})
                </span>
              </h3>
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="py-2 px-4 text-left font-medium">Worker</th>
                        <th className="py-2 px-4 text-left font-medium">Outlet</th>
                        <th className="py-2 px-4 text-right font-medium">Worked hrs</th>
                        <th className="py-2 px-4 text-right font-medium">Base salary</th>
                        <th className="py-2 px-4 text-right font-medium">Overtime</th>
                        <th className="py-2 px-4 text-right font-medium">Incentives</th>
                        <th className="py-2 px-4 text-right font-medium">Fines</th>
                        <th className="py-2 px-4 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {previewState.rows?.map(row => (
                        <tr key={row.workerId}>
                          <td className="py-2 px-4">{row.workerName}</td>
                          <td className="py-2 px-4 text-gray-500">{row.outletName || '—'}</td>
                          <td className="py-2 px-4 text-right">{row.workedHours.toFixed(2)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(row.baseSalary)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(row.overtime)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(row.incentives)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(row.fines)}</td>
                          <td className="py-2 px-4 text-right font-medium">{formatCurrency(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {generateState.status === 'success' && (
            <>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm border-t pt-4">
                <p className="text-green-700 font-medium">{generateState.message}</p>
                <button
                  type="button"
                  onClick={() => handlePrint('payroll-run')}
                  className="inline-flex items-center rounded-md border border-emerald-500 px-3 py-1.5 font-medium text-emerald-600 hover:bg-emerald-50 transition print:hidden"
                >
                  Print payroll run
                </button>
              </div>
              <PayrollRunTable
                rows={generateState.rows ?? []}
                month={generateState.month}
                onPrint={() => handlePrint('payroll-run')}
              />
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

              {/* Outlet Filter for Payslips */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Filter by Outlet
                </label>
                <select
                  value={payslipOutletFilter}
                  onChange={(e) => setPayslipOutletFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                >
                  <option value="">All Outlets</option>
                  {outlets.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
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
                  {filteredWorkers.map(worker => (
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
          <PayslipCard
            state={payslipState}
            onPrint={() => handlePrint('payslip')}
          />
        </div>
      </section>

      {/* Export Data */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-md ring-1 ring-black/5 print:hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold">Export Data</h2>
          <p className="mt-1 text-sm text-gray-500">
            Download worker statistics and payroll summaries as CSV.
          </p>
        </div>
        <div className="px-6 py-5">
          <form action={exportFormAction} className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Filter by Outlet
              </label>
              <select
                name="outlet_id"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">All Outlets</option>
                {outlets.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 transition"
            >
              Export CSV
            </button>
          </form>
          {exportState.status === 'error' && (
            <p className="mt-3 text-sm text-red-600">
              {exportState.message || 'Export failed.'}
            </p>
          )}
        </div>
      </section>
      {/* PRINT PORTAL */}
      {printSection && (
        <PrintPortal>
          <div className="p-8 bg-white min-h-screen">
            {printSection === 'payslip' && payslipState.slip && (
              <PayslipCard state={payslipState} />
            )}
            {printSection === 'payroll-run' && generateState.rows && (
              <PayrollRunTable rows={generateState.rows} month={generateState.month} />
            )}
            {printSection === 'worker-stats' && reportState.rows && (
              <WorkerStatsTable rows={reportState.rows} />
            )}
          </div>
        </PrintPortal>
      )}
    </div>
  )
}

