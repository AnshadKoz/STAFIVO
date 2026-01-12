import { createClient } from '@/utils/supabase/server'

export default async function DebugLoginPage() {
    const supabase = await createClient()

    // 1. Check Auth User
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    // 2. Check App User (RLS Check)
    let appUser = null
    let appUserError = null
    if (user) {
        const response = await supabase
            .from('app_users')
            .select('*')
            .eq('id', user.id)
            .single()
        appUser = response.data
        appUserError = response.error
    }

    // 3. Check Worker (RLS Check)
    let worker = null
    let workerError = null
    if (user) {
        const response = await supabase
            .from('workers')
            .select('*')
            .eq('auth_id', user.id)
            .single()
        worker = response.data
        workerError = response.error
    }

    return (
        <div className="p-8 font-mono text-sm text-black bg-white">
            <h1 className="text-xl font-bold mb-4 text-black">Login Debugger</h1>

            <section className="mb-8">
                <h2 className="font-bold text-blue-600 mb-2">1. Auth User (Supabase Auth)</h2>
                {authError ? (
                    <div className="text-red-600">Error: {authError.message}</div>
                ) : user ? (
                    <pre className="bg-gray-100 p-2 rounded text-black overflow-auto">{JSON.stringify(user, null, 2)}</pre>
                ) : (
                    <div className="text-orange-600">No User Logged In</div>
                )}
            </section>

            <section className="mb-8">
                <h2 className="font-bold text-blue-600 mb-2">2. App User Table (public.app_users)</h2>
                <div className="mb-2 text-black">Query: <code className="bg-gray-100 px-1 text-black">select * from app_users where id = '{user?.id}'</code></div>
                {appUserError ? (
                    <div className="text-red-600 border border-red-200 bg-red-50 p-2 rounded">
                        <strong>Error Code:</strong> {appUserError.code}<br />
                        <strong>Message:</strong> {appUserError.message}<br />
                        <strong>Details:</strong> {appUserError.details}<br />
                        <strong>Hint:</strong> {appUserError.hint}
                    </div>
                ) : appUser ? (
                    <pre className="bg-green-50 p-2 rounded border border-green-200 text-black overflow-auto">{JSON.stringify(appUser, null, 2)}</pre>
                ) : (
                    <div className="text-orange-600 font-bold">Row not found (RLS might be hiding it)</div>
                )}
            </section>

            <section className="mb-8">
                <h2 className="font-bold text-blue-600 mb-2">3. Workers Table (public.workers)</h2>
                <div className="mb-2 text-black">Query: <code className="bg-gray-100 px-1 text-black">select * from workers where auth_id = '{user?.id}'</code></div>
                {workerError ? (
                    <div className="text-red-600 border border-red-200 bg-red-50 p-2 rounded">
                        <strong>Error Code:</strong> {workerError.code}<br />
                        <strong>Message:</strong> {workerError.message}<br />
                        <strong>Details:</strong> {workerError.details}<br />
                        <strong>Hint:</strong> {workerError.hint}
                    </div>
                ) : worker ? (
                    <pre className="bg-green-50 p-2 rounded border border-green-200 text-black overflow-auto">{JSON.stringify(worker, null, 2)}</pre>
                ) : (
                    <div className="text-orange-600 font-bold">Row not found (RLS might be hiding it)</div>
                )}
            </section>
        </div>
    )
}
