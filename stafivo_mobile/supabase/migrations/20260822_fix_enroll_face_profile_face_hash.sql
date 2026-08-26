-- Fix: enroll_face_profile was inserting NULL into face_hash
-- Root cause: the live DB function diverged from the migration source —
-- face_hash was not correctly mapped to p_face_hash in the INSERT VALUES clause.
-- This re-deploys the function with every column explicitly bound to its parameter.

CREATE OR REPLACE FUNCTION enroll_face_profile(
  p_worker_id   uuid,
  p_embedding   vector,
  p_face_hash   text,
  p_image_url   text    DEFAULT NULL,
  p_embed_model text    DEFAULT 'mobilefacenet-128',
  p_version     integer DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  duplicate_worker uuid;
BEGIN
  -- Reject enrollment if the face already belongs to a DIFFERENT worker.
  duplicate_worker := detect_duplicate_face(p_embedding);

  IF duplicate_worker IS NOT NULL AND duplicate_worker <> p_worker_id THEN
    RAISE EXCEPTION
      'Face already enrolled for another worker: %',
      duplicate_worker
      USING ERRCODE = '23514';
  END IF;

  -- Insert or update face profile.
  -- Every column is explicitly mapped to its parameter to prevent accidental NULLs.
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
    p_face_hash,    -- FIX: was NULL in broken version; now correctly bound
    p_image_url,
    p_embed_model,
    p_version
  )
  ON CONFLICT (worker_id) DO UPDATE SET
    embedding   = EXCLUDED.embedding,
    face_hash   = EXCLUDED.face_hash,   -- FIX: also corrected in upsert path
    image_url   = EXCLUDED.image_url,
    embed_model = EXCLUDED.embed_model,
    version     = EXCLUDED.version;
END;
$$;

COMMENT ON FUNCTION enroll_face_profile IS
  'Safely enrolls a face profile with duplicate detection. '
  'Rejects enrollment if face already exists for a different worker. '
  'Fixed 2026-08-22: face_hash column now correctly bound to p_face_hash parameter.';
