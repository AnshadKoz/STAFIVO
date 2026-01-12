-- Fix enrollment status detection after RLS lock-down
-- This provides safe RPC functions to check enrollment status without exposing face_profiles
-- Required because face_profiles is now locked behind RLS and cannot be queried directly

-- Function 1: Get workers by outlet with enrollment status
-- Returns: id, name, enrolled (boolean)
CREATE OR REPLACE FUNCTION workers_by_outlet_with_enrollment(
  p_outlet_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  enrolled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    EXISTS (
      SELECT 1
      FROM face_profiles fp
      WHERE fp.worker_id = w.id
    ) AS enrolled
  FROM workers w
  WHERE w.outlet_id = p_outlet_id
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_by_outlet_with_enrollment
IS 'Returns workers for an outlet with safe enrollment status without exposing face_profiles';

-- Function 2: Get all workers with enrollment status (for general dropdown)
-- Returns: id, name, enrolled (boolean)
CREATE OR REPLACE FUNCTION workers_with_enrollment()
RETURNS TABLE (
  id uuid,
  name text,
  enrolled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    EXISTS (
      SELECT 1
      FROM face_profiles fp
      WHERE fp.worker_id = w.id
    ) AS enrolled
  FROM workers w
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_with_enrollment
IS 'Returns all workers with safe enrollment status without exposing face_profiles';

-- Function 3: Get workers needing enrollment (no face profile exists)
-- Returns: id, name
CREATE OR REPLACE FUNCTION workers_needing_enrollment()
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name
  FROM workers w
  WHERE NOT EXISTS (
    SELECT 1
    FROM face_profiles fp
    WHERE fp.worker_id = w.id
  )
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_needing_enrollment
IS 'Returns workers who need face enrollment (no face profile exists)';

-- Function 4: Get enrolled worker IDs only
-- Returns: worker_id (uuid)
CREATE OR REPLACE FUNCTION enrolled_worker_ids()
RETURNS TABLE (
  worker_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fp.worker_id
  FROM face_profiles fp;
$$;

COMMENT ON FUNCTION enrolled_worker_ids
IS 'Returns list of worker IDs who have face profiles enrolled';

-- Grant execute permissions to authenticated and anon users
GRANT EXECUTE ON FUNCTION workers_by_outlet_with_enrollment(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION workers_with_enrollment() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION workers_needing_enrollment() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION enrolled_worker_ids() TO authenticated, anon;

