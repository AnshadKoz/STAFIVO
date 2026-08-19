-- =============================================================================
-- soft_delete_worker(p_worker_id uuid)
-- =============================================================================
--
-- Purpose:
--   Marks a worker as soft-deleted by setting is_deleted = true and
--   deleted_at = now(). Does NOT delete any rows from any table.
--
-- Safety:
--   • Admin-only (checked via auth.uid() → app_users.role).
--   • Idempotent guard: if the worker is already soft-deleted, returns a
--     safe failure message without touching the row again.
--   • SECURITY DEFINER so the UPDATE runs without RLS interference.
--   • SET search_path = public prevents schema-injection.
--
-- Return shape (JSONB):
--   { "success": true,  "message": "...", "worker_id": "<uuid>" }
--   { "success": false, "message": "..." }
--
-- What this function does NOT do:
--   • Does NOT delete workers, attendance_logs, payroll_records,
--     worker_documents, face_profiles, worker_adjustments, fine_appeals,
--     app_users, or auth.users.
--   • Does NOT touch Supabase Storage.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_worker(p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        text;
  v_is_deleted  boolean;
BEGIN
  -- ── Step 0: Caller must be an admin ────────────────────────────────────────
  SELECT role
    INTO v_role
    FROM public.app_users
   WHERE auth_id = auth.uid()
   LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Forbidden: caller is not an admin'
    );
  END IF;

  -- ── Step 1: Verify the worker exists and check current state ───────────────
  SELECT is_deleted
    INTO v_is_deleted
    FROM public.workers
   WHERE id = p_worker_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Worker not found'
    );
  END IF;

  -- ── Step 2: Guard against double soft-delete ───────────────────────────────
  IF v_is_deleted IS TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Worker is already removed'
    );
  END IF;

  -- ── Step 3: Soft-delete — mark the worker, touch NOTHING else ─────────────
  UPDATE public.workers
     SET is_deleted = true,
         deleted_at = now()
   WHERE id = p_worker_id;

  RETURN jsonb_build_object(
    'success',   true,
    'message',   'Worker removed from active workforce',
    'worker_id', p_worker_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', SQLERRM
  );
END;
$$;


-- =============================================================================
-- GRANT / REVOKE
-- =============================================================================
REVOKE ALL ON FUNCTION public.soft_delete_worker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_worker(uuid) TO authenticated;
