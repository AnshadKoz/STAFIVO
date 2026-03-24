
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    try {
        let supabaseResponse = NextResponse.next({
            request,
        })

        console.log('--- EDGE RUNTIME PROXY LOG ---')
        console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
        console.log('------------------------------')

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            request.cookies.set(name, value)
                        )
                        supabaseResponse = NextResponse.next({
                            request,
                        })
                        cookiesToSet.forEach(({ name, value, options }) =>
                            supabaseResponse.cookies.set(name, value, options)
                        )
                    },
                },
            }
        )

        // IMPORTANT: Avoid writing any logic between createServerClient and
        // supabase.auth.getUser(). A simple mistake could make it very hard to debug
        // issues with users being randomly logged out.
        const {
            data: { user },
        } = await supabase.auth.getUser()

        if (
            !user &&
            !request.nextUrl.pathname.startsWith('/login') &&
            !request.nextUrl.pathname.startsWith('/auth')
        ) {
            // no user, potentially respond by redirecting the user to the login page
            // For now we will not force redirect here to avoid conflict with existing page logic,
            // but the session refresh has happened above.
            // If you want to enforce auth at middleware level, uncomment the lines below:

            // const url = request.nextUrl.clone()
            // url.pathname = '/login'
            // return NextResponse.redirect(url)
        }

        return supabaseResponse
    } catch (e) {
        // If you are here, a Supabase client could not be created!
        // This is likely because you have not set up environment variables.
        // Check out http://localhost:3000 for Next Steps.
        return NextResponse.next({
            request,
        })
    }
}
