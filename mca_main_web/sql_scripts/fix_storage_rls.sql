-- Fix Storage RLS for worker-docs bucket
-- The error "Upload failed" indicates the RLS failure is happening on storage.objects, not public.worker_documents (yet).
-- Usage: Run this script in the Supabase SQL Editor.

-- 1. Create a policy to allow workers to upload files to their own folder
-- Folder structure is: {worker_id}/{filename}
-- We check if the folder name matches the ID of a worker linked to the current auth user.

BEGIN;

-- Policy for INSERT (Upload)
DROP POLICY IF EXISTS "Give workers access to own folder 1q2w3e" ON storage.objects;
DROP POLICY IF EXISTS "workers_insert_own_folder" ON storage.objects;

CREATE POLICY "workers_insert_own_folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'worker-docs' AND
  (
    -- Check if the first path segment (folder name) is a generic UUID matching the worker's ID
    EXISTS (
        SELECT 1 FROM public.workers w
        WHERE w.auth_id = auth.uid()
        AND w.id::text = (storage.foldername(name))[1]
    )
  )
);

-- Policy for SELECT (Download/View)
-- Allows workers to read files if they own the worker profile corresponding to the folder
DROP POLICY IF EXISTS "workers_select_own_folder" ON storage.objects;

CREATE POLICY "workers_select_own_folder"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'worker-docs' AND
  (
    EXISTS (
        SELECT 1 FROM public.workers w
        WHERE w.auth_id = auth.uid()
        AND w.id::text = (storage.foldername(name))[1]
    )
  )
);

-- Policy for UPDATE (Overwrite if needed, though usually new files are unique)
DROP POLICY IF EXISTS "workers_update_own_folder" ON storage.objects;

CREATE POLICY "workers_update_own_folder"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'worker-docs' AND
  (
    EXISTS (
        SELECT 1 FROM public.workers w
        WHERE w.auth_id = auth.uid()
        AND w.id::text = (storage.foldername(name))[1]
    )
  )
);

-- Ensure managers/admins can still access everything (assuming they have 'admin full' or similar generic policies)
-- If not, you might need to add manager policies here too, but usually admins have broader access.

COMMIT;
