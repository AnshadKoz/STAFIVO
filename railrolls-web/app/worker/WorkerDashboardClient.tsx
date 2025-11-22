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
}

type DailyRow = { work_date: string; hours_worked: number | null }

type AdjustmentRow = {
  id: string
  effective_date: string
  kind: 'ot' | 'fine' | 'incentive' | 'deduction'
  hours: number | null
  amount: number | null
  note: string | null
}

type DocumentRow = {
  id: string
  kind: 'bank_passbook' | 'health_card' | 'other'
  storage_path: string
  original_name: string
  created_at: string
  signedUrl?: string | null
}

type WorkerDashboardClientProps = {
  worker: WorkerInfo
  weeklyHours: number
  monthlyHours: number
  dailyRows: DailyRow[]
  adjustments: AdjustmentRow[]
  documents: DocumentRow[]
  authUserId: string
}

const actionInit: WorkerActionResult = { status: 'success' }

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
      docs.map(async doc => {
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
        uploaded_by: authUserId,
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

  const openAppealModal = (adjustment: AdjustmentRow) => {
    setAppealAdjustment(adjustment)
    setAppealReason('')
  }

  const closeAppealModal = () => {
    setAppealAdjustment(null)
    setAppealReason('')
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
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">Rail Rolls</p>
              <h1 className="mt-2 text-3xl font-semibold text-gray-900">Hi, {worker.name}</h1>
              <p className="text-sm text-gray-500">Keep an eye on your shifts, appeals, and documents.</p>
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

        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent adjustments</h2>
            <p className="text-sm text-gray-500">Includes OT, fines, incentives, deductions.</p>
          </div>
          <div className="mt-4 space-y-3">
            {adjustments.length === 0 ? (
              <p className="text-sm text-gray-500">No adjustments yet.</p>
            ) : (
              adjustments.map(adj => (
                <div
                  key={adj.id}
                  className="rounded-2xl border border-gray-100 px-4 py-3 shadow-sm sm:flex sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {adj.kind.toUpperCase()} · {new Date(adj.effective_date).toLocaleDateString('en-IN')}
                    </p>
                    <p className="text-xs text-gray-500">{adj.note ?? '—'}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-3 sm:mt-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {adj.kind === 'ot'
                        ? `${(adj.hours ?? 0).toFixed(1)} hrs`
                        : currency(adj.amount)}
                    </p>
                    {adj.kind === 'fine' ? (
                      <button
                        type="button"
                        onClick={() => openAppealModal(adj)}
                        className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        Appeal
                      </button>
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
            {(['bank_passbook', 'health_card'] as DocumentRow['kind'][]).map(kind => (
              <div key={kind} className="rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {kind === 'bank_passbook' ? 'Bank Passbook' : 'Health Card'}
                    </p>
                    <p className="text-xs text-gray-500">Upload clear photos or PDFs.</p>
                  </div>
                  <label className="cursor-pointer rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                    {uploading === kind ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={event => handleFileUpload(kind, event)}
                    />
                  </label>
                </div>
                <div className="mt-3 space-y-2">
                  {(documentsByKind[kind] ?? []).length === 0 ? (
                    <p className="text-xs text-gray-500">No files yet.</p>
                  ) : (
                    documentsByKind[kind].map(doc => (
                      <a
                        key={doc.id}
                        href={doc.signedUrl ?? '#'}
                        className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>{doc.original_name}</span>
                        <span>{new Date(doc.created_at).toLocaleDateString('en-IN')}</span>
                      </a>
                    ))
                  )}
                </div>
              </div>
            ))}
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
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow ${
              isAppealPending
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
    </div>
  )
}
