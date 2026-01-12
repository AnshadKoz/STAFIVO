-- =================================================================
-- WORKFLOW: GRANT WEB ACCESS TO A WORKER
-- =================================================================
-- Prerequisites:
-- 1. Create the Worker in the Admin/Manager UI (this creates the row in 'public.workers').
--    Note the Worker's Name and ID (or just their email).
-- 2. Create the User in Supabase Auth (Authentication -> Add User).
--    Copy the new User UUID (AUTH_ID).
-- =================================================================

-- STEP 1: VARIABLES (Replace these 4 values!)
-- -----------------------------------------------------------------
-- The UUID from Supabase Auth
\set new_auth_id      'PLACEHOLDER_AUTH_ID_FROM_SUPABASE'

-- The details of the worker (must match what is in public.workers)
\set worker_email     'worker@example.com'
\set worker_name      'Worker Name'
\set worker_outlet_id 'PLACEHOLDER_OUTLET_ID'

-- The existing ID of the worker in the workers table
\set worker_table_id  'PLACEHOLDER_WORKER_TABLE_ID'
-- -----------------------------------------------------------------


-- STEP 2: Create the App User (for Login roles)
-- CRITICAL: We set BOTH 'id' and 'auth_id' to the Supabase Auth ID.
INSERT INTO public.app_users (
    id,
    auth_id,       -- <--- THIS WAS MISSING BEFORE
    email,
    name,
    role,
    outlet_id
)
VALUES (
    :'new_auth_id',
    :'new_auth_id', -- <--- MUST MATCH 'id'
    :'worker_email',
    :'worker_name',
    'worker',
    :'worker_outlet_id'
);


-- STEP 3: Link the existing Worker profile to the Login
UPDATE public.workers
SET auth_id = :'new_auth_id'
WHERE id = :'worker_table_id';


-- =================================================================
-- DONE! The worker can now log in.
-- =================================================================
