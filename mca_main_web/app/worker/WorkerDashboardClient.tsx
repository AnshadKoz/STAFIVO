'use client'

import { ChangeEvent, useActionState, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Modal from '@/components/ui/Modal'
import { supabase } from '@/lib/supabaseClient'
import { submitFineAppealAction, type WorkerActionResult } from './workerActions'
import { useToast } from '@/app/_components/ToastProvider'

type WorkerInfo = {
  id: string
  name: string
  base_salary_per_hour: number | null
  ot_rate_per_hour: number | null
  outlets: { name: string } | null
}

type DailyRow = { work_date: string; hours_worked: number | null }

type AdjustmentRow = {
  id: string
  effective_date: string
  kind: 'ot' | 'fine' | 'incentive' | 'deduction'
  hours: number | null
  amount: number | null
  note: string | null
  fine_appeals?: { id: string; status: 'pending' | 'approved' | 'rejected' } | { id: string; status: 'pending' | 'approved' | 'rejected' }[] | null
}

type DocumentRow = {
  id: string
  kind: 'bank_passbook' | 'health_card' | 'other'
  storage_path: string
  original_name: string
  created_at: string
  signedUrl?: string | null
}

type PayrollRecord = {
  id: string;
  payroll_month: string;
  base_salary: number;
  overtime: number;
  incentives: number;
  fines: number;
  calculated_total: number;
  created_at: string;
};

type WorkerDashboardClientProps = {
  worker: WorkerInfo;
  weeklyHours: number;
  monthlyHours: number;
  dailyRows: DailyRow[];
  adjustments: AdjustmentRow[];
  documents: DocumentRow[];
  payrollRecords: PayrollRecord[];
  authUserId: string;
};

const actionInit: WorkerActionResult = { status: 'idle' }

const currency = (value: number | null | undefined) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
    : '₹0.00'

const rate = (value: number | null | undefined) =>
  typeof value === 'number' ? `${currency(value)}/hr` : 'Not set'

export default function WorkerDashboardClient({
  worker,
  weeklyHours,
  monthlyHours,
  dailyRows,
  adjustments,
  documents: initialDocuments,
  payrollRecords,
  authUserId,
}: WorkerDashboardClientProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [uploading, setUploading] = useState<'bank_passbook' | 'health_card' | 'other' | null>(null)
  const [appealAdjustment, setAppealAdjustment] = useState<AdjustmentRow | null>(null)
  const [appealState, appealAction, isAppealPending] = useActionState(submitFineAppealAction, actionInit)
  const [appealReason, setAppealReason] = useState('')
  const initialAppealEffect = useRef(true)
  const { showToast } = useToast()

  useEffect(() => {
    if (initialAppealEffect.current) {
      initialAppealEffect.current = false
      return
    }

    if (appealState.status === 'success') {
      showToast({
        type: 'success',
        title: 'Appeal submitted',
        description: appealState.message ?? 'Your fine appeal was sent to your manager.',
      })
      const timeout = setTimeout(() => {
        setAppealAdjustment(null)
        setAppealReason('')
      }, 0)
      return () => clearTimeout(timeout)
    }

    if (appealState.status === 'error') {
      showToast({
        type: 'error',
        title: 'Could not submit appeal',
        description: appealState.message ?? 'Something went wrong, please try again.',
      })
    }
  }, [appealState, showToast])

  const sortedDaily = useMemo(
    () =>
      [...dailyRows]
        .slice()
        .reverse()
        .map(row => ({
          ...row,
          hours_worked: row.hours_worked ?? 0,
        })),
    [dailyRows]
  )

  const decorateDocuments = async (docs: DocumentRow[]) =>
    Promise.all(
      (docs ?? []).map(async doc => {
        const { data } = await supabase.storage.from('worker-docs').createSignedUrl(doc.storage_path, 60 * 60)
        return { ...doc, signedUrl: data?.signedUrl ?? null }
      })
    )

  useEffect(() => {
    let active = true
    const run = async () => {
      const signed = await decorateDocuments(initialDocuments)
      if (active) {
        setDocuments(signed)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [initialDocuments])

  const documentsByKind = useMemo(() => {
    const map: Record<DocumentRow['kind'], DocumentRow[]> = {
      bank_passbook: [],
      health_card: [],
      other: [],
    }
    documents.forEach(doc => {
      map[doc.kind]?.push(doc)
    })
    return map
  }, [documents])

  const handleFileUpload = async (kind: DocumentRow['kind'], event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(kind)
    const safeName = file.name.replace(/\s+/g, '-').toLowerCase()
    const filePath = `${worker.id}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from('worker-docs').upload(filePath, file)
    if (uploadError) {
      console.error('Upload failed', uploadError.message)
      setUploading(null)
      return
    }

    const { error: insertError } = await supabase.from('worker_documents').insert([
      {
        worker_id: worker.id,
        kind,
        storage_path: filePath,
        original_name: file.name,
      },
    ])

    if (insertError) {
      console.error('Document insert failed', insertError.message)
      setUploading(null)
      return
    }

    const { data: refreshed } = await supabase
      .from('worker_documents')
      .select('id,kind,storage_path,original_name,created_at')
      .eq('worker_id', worker.id)
      .order('created_at', { ascending: false })
    const signed = await decorateDocuments(refreshed ?? [])
    setDocuments(signed)
    setUploading(null)
    event.target.value = ''
  }

  const [deleteCandidate, setDeleteCandidate] = useState<DocumentRow | null>(null)

  const confirmDelete = (doc: DocumentRow) => {
    setDeleteCandidate(doc)
  }

  const executeDelete = async () => {
    if (!deleteCandidate) return

    const { error: storageError } = await supabase.storage.from('worker-docs').remove([deleteCandidate.storage_path])
    if (storageError) {
      console.error('Delete storage failed', storageError.message)
      showToast({ type: 'error', title: 'Delete failed', description: 'Could not delete file from storage.' })
      setDeleteCandidate(null)
      return
    }

    const { error: dbError } = await supabase.from('worker_documents').delete().eq('id', deleteCandidate.id)
    if (dbError) {
      console.error('Delete db failed', dbError.message)
      showToast({ type: 'error', title: 'Delete failed', description: 'Could not delete record.' })
      setDeleteCandidate(null)
      return
    }

    showToast({ type: 'success', title: 'Deleted', description: 'Document removed.' })
    setDeleteCandidate(null)

    const { data: refreshed } = await supabase
      .from('worker_documents')
      .select('id,kind,storage_path,original_name,created_at')
      .eq('worker_id', worker.id)
      .order('created_at', { ascending: false })
    const signed = await decorateDocuments(refreshed ?? [])
    setDocuments(signed)
  }

  const openAppealModal = (adjustment: AdjustmentRow) => {
    setAppealAdjustment(adjustment)
    setAppealReason('')
  }

  // ... existing closeAppealModal ...

  const closeAppealModal = () => {
    setAppealAdjustment(null)
    setAppealReason('')
  }

  const closeDeleteModal = () => {
    setDeleteCandidate(null)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-emerald-50 to-white px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-4">
                <img src="/workforge-logo.png" alt="WorkForge" className="h-14 w-auto object-contain" />
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 leading-none">
                    {worker.name}
                    <span className="ml-2 rounded-full bg-emerald-100 px-3 py-0.5 text-sm font-medium text-emerald-800 align-middle">
                      Worker
                    </span>
                  </h1>
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    My Dashboard {worker.outlets?.name ? `· ${worker.outlets.name}` : ''}
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-700"
            >
              Log out
            </button>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">This week</p>
              <p className="mt-2 text-3xl font-bold">{weeklyHours.toFixed(1)} hrs</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">This month</p>
              <p className="mt-2 text-3xl font-bold">{monthlyHours.toFixed(1)} hrs</p>
            </div>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">My Rates</h2>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                <span>Base rate</span>
                <span className="font-semibold text-gray-900">{rate(worker.base_salary_per_hour)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                <span>OT rate</span>
                <span className="font-semibold text-gray-900">{rate(worker.ot_rate_per_hour)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Hours worked</h2>
            <div className="mt-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sortedDaily}>
                  <defs>
                    <linearGradient id="hoursGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="work_date" hide />
                  <YAxis hide />
                  <Tooltip />
                  <Area type="monotone" dataKey="hours_worked" stroke="#10b981" fill="url(#hoursGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Salary History — full width so the 6-column table never overflows */}
        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Salary History</h2>
          <p className="mt-1 text-sm text-gray-500">All payroll records for your account</p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100">
            {payrollRecords.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No salary records yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="px-4 py-3 text-left font-semibold">Month</th>
                    <th className="px-4 py-3 text-right font-semibold">Base</th>
                    <th className="px-4 py-3 text-right font-semibold">OT</th>
                    <th className="px-4 py-3 text-right font-semibold">Incentives</th>
                    <th className="px-4 py-3 text-right font-semibold">Fines</th>
                    <th className="px-4 py-3 text-right font-semibold text-emerald-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRecords.map((rec) => (
                    <tr key={rec.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{rec.payroll_month}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency(rec.base_salary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency(rec.overtime)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency(rec.incentives)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency(rec.fines)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">{currency(rec.calculated_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Recent Adjustments — full width below */}
        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Recent adjustments</h2>
          <p className="mt-1 text-sm text-gray-500">Includes OT, fines, incentives, deductions.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {adjustments.length === 0 ? (
              <p className="text-sm text-gray-500">No adjustments yet.</p>
            ) : (
              adjustments.map(adj => (
                <div
                  key={adj.id}
                  className="rounded-2xl border border-gray-100 px-4 py-3 shadow-sm flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {adj.kind.toUpperCase()} · {new Date(adj.effective_date).toLocaleDateString('en-IN')}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{adj.note ?? '—'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {adj.kind === 'ot'
                        ? `${(adj.hours ?? 0).toFixed(1)} hrs`
                        : currency(adj.amount)}
                    </p>
                    {adj.kind === 'fine' ? (
                      (() => {
                        const appeal = Array.isArray(adj.fine_appeals) ? adj.fine_appeals[0] : adj.fine_appeals

                        if (appeal?.status === 'approved') {
                          return (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                              Resolved
                            </span>
                          )
                        }
                        if (appeal?.status === 'pending') {
                          return (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                              Appeal Pending
                            </span>
                          )
                        }
                        if (appeal?.status === 'rejected') {
                          return (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                              Appeal Rejected
                            </span>
                          )
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => openAppealModal(adj)}
                            className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            Appeal
                          </button>
                        )
                      })()
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">My documents</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(['bank_passbook', 'health_card'] as DocumentRow['kind'][]).map(kind => {
              const hasDocs = (documentsByKind[kind] ?? []).length > 0
              return (
                <div key={kind} className="rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {kind === 'bank_passbook' ? 'Bank Passbook' : 'Health Card'}
                        </p>
                        {hasDocs ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            Uploaded
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-gray-500">Upload clear photos or PDFs.</p>
                    </div>
                    <label className="cursor-pointer rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                      {uploading === kind ? 'Uploading…' : hasDocs ? 'Re-upload' : 'Upload'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={event => handleFileUpload(kind, event)}
                      />
                    </label>
                  </div>
                  <div className="mt-3 space-y-2">
                    {hasDocs ? (
                      documentsByKind[kind].map(doc => (
                        <div key={doc.id} className="flex items-center gap-2">
                          <a
                            href={doc.signedUrl ?? '#'}
                            className="flex flex-1 items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="truncate max-w-[180px]">{doc.original_name}</span>
                            <span className="shrink-0 ml-2">{new Date(doc.created_at).toLocaleDateString('en-IN')}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => confirmDelete(doc)}
                            className="rounded-xl border border-red-100 bg-white p-2 text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
                            title="Delete document"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-500">No files yet.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(appealAdjustment)}
        onClose={closeAppealModal}
        title="Appeal this fine"
        description={appealAdjustment ? `Adjustment on ${appealAdjustment.effective_date}` : undefined}
      >
        <form action={appealAction} className="space-y-4">
          <input type="hidden" name="adjustment_id" value={appealAdjustment?.id ?? ''} />
          <textarea
            name="reason"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="Explain why this fine should be removed"
            value={appealReason}
            onChange={e => setAppealReason(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={isAppealPending}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow ${isAppealPending
              ? 'cursor-not-allowed bg-emerald-400'
              : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
          >
            {isAppealPending ? 'Submitting...' : 'Submit appeal'}
          </button>
          {appealState.status === 'error' && appealState.message ? (
            <p className="text-xs text-red-500">{appealState.message}</p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteCandidate)}
        onClose={closeDeleteModal}
        title="Delete Document"
        description="Are you sure you want to delete this document? This action cannot be undone."
      >
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={closeDeleteModal}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={executeDelete}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}
