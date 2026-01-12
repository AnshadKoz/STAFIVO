-- Enable DELETE for Worker Documents
-- This script allows workers to delete their own documents from DB and Storage.

BEGIN;

-- 1. DB: Allow Delete on public.worker_documents
-- Matches the existing SELECT/INSERT logic: Worker can delete rows where worker_id is linked to their auth_id
DROP POLICY IF EXISTS "workers_delete_own_docs" ON public.worker_documents;

CREATE POLICY "workers_delete_own_docs"
ON public.worker_documents
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = public.worker_documents.worker_id
    AND w.auth_id = auth.uid()
  )
);

-- 2. Storage: Allow Delete on worker-docs bucket
-- Matches the permissive Intsert/Select logic we established earlier
DROP POLICY IF EXISTS "docs: permit delete" ON storage.objects;

CREATE POLICY "docs: permit delete"
ON storage.objects
FOR DELETE
TO authenticated
USING ( bucket_id = 'worker-docs' );

COMMIT;
