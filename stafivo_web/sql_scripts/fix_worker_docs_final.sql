-- Final Fix for worker_documents RLS
-- 1. Corrects the column definition to allow NULL uploaded_by
-- 2. Updates the RLS policy to NOT require uploaded_by for workers
-- 3. Bypasses the Foreign Key issue entirely for worker uploads

-- Step 1: Allow uploaded_by to be NULL
ALTER TABLE public.worker_documents
ALTER COLUMN uploaded_by DROP NOT NULL;

-- Step 2: Drop potentially conflicting policies
DROP POLICY IF EXISTS "docs: worker insert" ON public.worker_documents;
DROP POLICY IF EXISTS "docs: worker read own" ON public.worker_documents;

-- Step 3: Create correct INSERT policy (No uploaded_by check)
CREATE POLICY "docs: worker insert"
ON public.worker_documents
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow insert if the worker_id belongs to the current auth user
  EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = worker_documents.worker_id
    AND w.auth_id = auth.uid()
  )
);

-- Step 4: Create correct SELECT policy (No uploaded_by check)
CREATE POLICY "docs: worker read own"
ON public.worker_documents
FOR SELECT
TO authenticated
USING (
  -- Matches if the document belongs to the worker profile associated with the current user
  EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = worker_documents.worker_id
    AND w.auth_id = auth.uid()
  )
);
