-- Fix missing app_users records for workers who have an auth_id
-- This will enable login for workers created during the window where the bug existed.

INSERT INTO public.app_users (id, email, name, role, outlet_id, auth_id)
SELECT
    w.auth_id,        -- Use Auth ID as the App User ID
    w.email,
    w.name,
    'worker'::public.user_role, -- Cast to user_role enum
    w.outlet_id,
    w.auth_id
FROM public.workers w
LEFT JOIN public.app_users au ON au.auth_id = w.auth_id
WHERE w.auth_id IS NOT NULL
AND au.id IS NULL;

-- Query to verify the fix
SELECT * FROM public.app_users WHERE role = 'worker' ORDER BY created_at DESC;
