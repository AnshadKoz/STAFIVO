export default function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-emerald-50 text-gray-900">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
        <p className="text-sm font-semibold tracking-wide text-emerald-700">Preparing your dashboard…</p>
      </div>
    </div>
  )
}
