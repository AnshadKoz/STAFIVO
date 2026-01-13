-- Fix RLS policy for worker_documents upload
-- The error "new row violates row-level security policy" occurs because the existing policy likely doesn't allow the insert.

-- 1. Enable RLS (idempotent)
ALTER TABLE public.worker_documents ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing worker insert policy (if any) to avoid conflicts
DROP POLICY IF EXISTS "docs: worker insert" ON public.worker_documents;
DROP POLICY IF EXISTS "docs: worker read own" ON public.worker_documents;

-- 3. Create correct INSERT policy
-- This allows a user to insert a document if:
--   a) The 'worker_id' column matches a value in 'public.workers' that belongs to the current auth user (auth_id = auth.uid())
--   b) The 'uploaded_by' column matches the current auth user (auth.uid())
CREATE POLICY "docs: worker insert"
ON public.worker_documents
FOR INSERT
TO authenticated
WITH CHECK (
  -- Ensure the worker_id being inserted belongs to the authenticated user
  EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = worker_documents.worker_id
    AND w.auth_id = auth.uid()
  )
  -- Ensure the uploaded_by field is set to self
  AND uploaded_by = auth.uid()
);

-- 4. Create correct SELECT policy
-- Allow workers to read their own documents
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
