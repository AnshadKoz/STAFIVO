-- Allow managers to delete adjustments they created
DROP POLICY IF EXISTS "Managers can delete their own adjustments" ON public.worker_adjustments;

CREATE POLICY "Managers can delete their own adjustments"
ON public.worker_adjustments
FOR DELETE
USING (
  created_by IN (
    SELECT id FROM public.app_users WHERE auth_id = auth.uid()
  )
);
