-- 1. Fix the 'created_by' default value as requested
ALTER TABLE public.workers
ALTER COLUMN created_by DROP DEFAULT;

ALTER TABLE public.workers
ALTER COLUMN created_by
    SET DEFAULT public.current_app_user_id();

-- 2. CRITICAL FIX: Add RLS policy to allow workers to read their own row
-- Your screenshots showed that 'public.workers' only had an Admin policy.
-- Workers need to be able to read their own row to load the dashboard.

DROP POLICY IF EXISTS "workers: worker read self" ON public.workers;

CREATE POLICY "workers: worker read self"
ON public.workers
FOR SELECT
TO authenticated
USING (
  auth_id = auth.uid()
);

-- 3. Ensure RLS is enabled on workers (just in case)
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
