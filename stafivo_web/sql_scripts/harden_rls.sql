-- 1. Fix: Allow managers to delete their own adjustments (Addressing the immediate issue)
-- This ensures managers can clean up mistakes they made in manual adjustments.
DROP POLICY IF EXISTS "Managers can delete their own adjustments" ON public.worker_adjustments;

CREATE POLICY "Managers can delete their own adjustments"
ON public.worker_adjustments
FOR DELETE
USING (
  created_by IN (
    SELECT id FROM public.app_users WHERE auth_id = auth.uid()
  )
);

-- 2. Security Upgrade: Enable RLS on Attendance Logs (Currently DISABLED in screenshots)
-- Leaving this disabled exposes sensitive location and attendance data.
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins have full access
CREATE POLICY "attendance_logs_admin_full" ON public.attendance_logs
AS PERMISSIVE FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_users 
    WHERE id = (SELECT id FROM public.app_users WHERE auth_id = auth.uid() LIMIT 1) 
    AND role = 'admin'
  )
);

-- Policy: Managers can view logs for their outlet
CREATE POLICY "attendance_logs_manager_view_outlet" ON public.attendance_logs
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  outlet_id IN (
    SELECT outlet_id FROM public.managers 
    WHERE app_user_id = (SELECT id FROM public.app_users WHERE auth_id = auth.uid())
  )
);

-- Policy: Workers can view their own logs
CREATE POLICY "attendance_logs_worker_view_own" ON public.attendance_logs
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  worker_id IN (
    SELECT id FROM public.workers WHERE auth_id = auth.uid()
  )
);

-- Policy: Workers can insert their own logs (Clock In/Out)
CREATE POLICY "attendance_logs_worker_insert_own" ON public.attendance_logs
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  worker_id IN (
    SELECT id FROM public.workers WHERE auth_id = auth.uid()
  )
);

-- 3. Security Upgrade: Enable RLS on Payroll Audit (Currently DISABLED in screenshots)
-- Protects financial generation records.
ALTER TABLE public.payroll_generation_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Admins have full access
CREATE POLICY "payroll_audit_admin_full" ON public.payroll_generation_audit
AS PERMISSIVE FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_users 
    WHERE id = (SELECT id FROM public.app_users WHERE auth_id = auth.uid() LIMIT 1) 
    AND role = 'admin'
  )
);

-- Policy: Who generated it can view it (e.g. Manager who ran payroll)
CREATE POLICY "payroll_audit_creator_view" ON public.payroll_generation_audit
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  generated_by IN (
    SELECT id FROM public.app_users WHERE auth_id = auth.uid()
  )
);
