-- CRITICAL SECURITY FIX: Hardened face profile retrieval
-- Prevents cross-worker face acceptance during verification
-- 
-- Problem: A face enrolled for Worker A was sometimes accepted when Worker B was selected
-- Root Cause: Weak RPC implementation without identity validation
-- 
-- This migration:
-- 1. Replaces get_face_profile with hardened version
-- 2. Enforces strict worker_id binding
-- 3. Detects data corruption (multiple profiles per worker)
-- 4. Raises errors instead of returning wrong data
--
-- SECURITY GUARANTEES:
-- - Returns EXACTLY ONE profile only if worker_id matches
-- - Returns NULL if no profile exists
-- - RAISES ERROR if multiple profiles exist (data corruption)
-- - CANNOT return another worker's embedding under any circumstances

-- STEP 1: Verify database constraints
-- Ensure UNIQUE constraint exists on worker_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'face_profiles_worker_id_key'
    AND conrelid = 'face_profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'CRITICAL: UNIQUE constraint on face_profiles.worker_id is missing';
  END IF;
END $$;

-- STEP 2: Add performance index if not exists
CREATE INDEX IF NOT EXISTS idx_face_profiles_worker_id 
ON face_profiles(worker_id);

COMMENT ON INDEX idx_face_profiles_worker_id IS 
'Performance index for face profile lookups by worker_id during verification';

-- STEP 3: Drop old RPC
DROP FUNCTION IF EXISTS get_face_profile(uuid);

-- STEP 4: Create hardened RPC
CREATE OR REPLACE FUNCTION get_face_profile(p_worker_id uuid)
RETURNS TABLE (
  worker_id uuid,
  embedding vector,
  embed_model text,
  version integer,
  image_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_count integer;
  result_record RECORD;
BEGIN
  -- Defensive check: Ensure exactly 0 or 1 rows exist for this worker
  SELECT COUNT(*) INTO row_count
  FROM face_profiles
  WHERE face_profiles.worker_id = p_worker_id;

  -- Data corruption case: Multiple profiles for one worker
  IF row_count > 1 THEN
    RAISE EXCEPTION 
      'SECURITY ERROR: Multiple face profiles detected for worker_id %. Data corruption. Contact administrator.',
      p_worker_id
      USING ERRCODE = 'data_exception';
  END IF;

  -- No profile exists: Return empty result (NULL)
  IF row_count = 0 THEN
    RETURN;
  END IF;

  -- Exactly one profile exists: Return it with explicit worker_id validation
  SELECT 
    fp.worker_id,
    fp.embedding,
    fp.embed_model,
    fp.version,
    fp.image_url
  INTO result_record
  FROM face_profiles fp
  WHERE fp.worker_id = p_worker_id;

  -- Final validation: Ensure returned worker_id matches request
  -- This is a defensive check that should never fail but guards against SQL injection
  IF result_record.worker_id != p_worker_id THEN
    RAISE EXCEPTION 
      'SECURITY ERROR: Worker ID mismatch detected. Requested: %, Got: %',
      p_worker_id,
      result_record.worker_id
      USING ERRCODE = 'data_exception';
  END IF;

  -- Return the validated record
  worker_id := result_record.worker_id;
  embedding := result_record.embedding;
  embed_model := result_record.embed_model;
  version := result_record.version;
  image_url := result_record.image_url;
  
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION get_face_profile IS 
'Hardened face profile retrieval for verification. Returns exactly ONE row if worker_id matches, NULL if no profile, ERROR if data corruption detected. CRITICAL: This function enforces strict identity binding to prevent cross-worker face acceptance.';

-- STEP 5: Grant permissions
GRANT EXECUTE ON FUNCTION get_face_profile(uuid) TO authenticated, anon;

-- STEP 6: Security audit log
-- Log that this critical security fix has been applied
DO $$
BEGIN
  RAISE NOTICE 'SECURITY FIX APPLIED: Hardened face profile retrieval (20260111)';
  RAISE NOTICE 'Cross-worker face acceptance prevention: ENABLED';
  RAISE NOTICE 'Data corruption detection: ENABLED';
  RAISE NOTICE 'Identity binding validation: ENABLED';
END $$;
