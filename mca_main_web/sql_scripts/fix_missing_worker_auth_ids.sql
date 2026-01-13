-- Fix Missing Auth IDs for Workers
-- The "new row violates row-level security policy" error persists because RLS checks if workers.auth_id = auth.uid().
-- If workers.auth_id is NULL for your existing workers, the check fails, even if they are logged in.
-- This script links existing workers to their Auth Users by matching their Email Address.

-- Usage: Run this script in the Supabase SQL Editor.

BEGIN;

-- Update workers table:
-- Find users in auth.users with the same email as the worker,
-- and set the worker's auth_id to that user's ID.
UPDATE public.workers
SET auth_id = users.id
FROM auth.users
WHERE public.workers.email = auth.users.email
  AND public.workers.auth_id IS NULL;

-- Log the result (optional, just for confirmation if running manually)
-- You can run checking query after:
-- SELECT id, name, email, auth_id FROM public.workers;

COMMIT;
