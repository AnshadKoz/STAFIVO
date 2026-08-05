export default function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-blue-50 text-gray-900">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/brand/logo-icon.svg"
          alt="STAFIVO"
          className="h-12 w-auto animate-pulse"
        />
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="text-sm font-semibold tracking-wide text-blue-700">
          Preparing your dashboard…
        </p>
      </div>
    </div>
  )
}
