-- Duplicate Face Prevention: Security hardening to prevent same face enrollment for multiple workers
-- This migration adds database-level duplicate face detection using cosine similarity
-- and enforces enrollment through RPC function only.

-- STEP 1: Ensure vector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- STEP 2: Duplicate Face Detection Function
-- Checks if a face embedding already exists for another worker
-- Returns the worker_id if duplicate found, NULL if face is unique
CREATE OR REPLACE FUNCTION detect_duplicate_face(
  new_embedding vector,
  similarity_threshold float DEFAULT 0.40
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_worker uuid;
BEGIN
  SELECT fp.worker_id
  INTO existing_worker
  FROM face_profiles fp
  WHERE cosine_distance(fp.embedding, new_embedding) < similarity_threshold
  LIMIT 1;

  RETURN existing_worker;
END;
$$;

COMMENT ON FUNCTION detect_duplicate_face IS 'Detects if a face embedding already exists for another worker. Returns worker_id if duplicate found, NULL if unique.';

-- STEP 3: Safe Face Enrollment Function (MANDATORY)
-- This function MUST be used for all face enrollments
-- Blocks duplicate faces and enforces one face per worker
CREATE OR REPLACE FUNCTION enroll_face_profile(
  p_worker_id uuid,
  p_embedding vector,
  p_face_hash text,
  p_image_url text DEFAULT NULL,
  p_embed_model text DEFAULT 'mobilefacenet-128',
  p_version integer DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  duplicate_worker uuid;
BEGIN
  -- Check for duplicate face
  duplicate_worker := detect_duplicate_face(p_embedding);

  IF duplicate_worker IS NOT NULL THEN
    RAISE EXCEPTION
      'Face already enrolled for another worker: %',
      duplicate_worker
      USING ERRCODE = '23514';
  END IF;

  -- Insert face profile safely
  INSERT INTO face_profiles (
    worker_id,
    embedding,
    face_hash,
    image_url,
    embed_model,
    version
  )
  VALUES (
    p_worker_id,
    p_embedding,
    p_face_hash,
    p_image_url,
    p_embed_model,
    p_version
  )
  ON CONFLICT (worker_id) DO UPDATE SET
    embedding = EXCLUDED.embedding,
    face_hash = EXCLUDED.face_hash,
    image_url = EXCLUDED.image_url,
    embed_model = EXCLUDED.embed_model,
    version = EXCLUDED.version;
END;
$$;

COMMENT ON FUNCTION enroll_face_profile IS 'Safely enrolls a face profile with duplicate detection. Rejects enrollment if face already exists for another worker.';

-- STEP 4: Lock down face_profiles table - Remove dangerous public insert policy
-- This prevents direct client-side inserts, forcing all enrollments through RPC
DROP POLICY IF EXISTS face_profiles_public_all ON face_profiles;

-- Note: Existing RLS policies for authenticated users (admin/manager/worker) remain intact
-- This ensures face verification during check-in still works
-- Only direct INSERT from public/unauthenticated clients is blocked

