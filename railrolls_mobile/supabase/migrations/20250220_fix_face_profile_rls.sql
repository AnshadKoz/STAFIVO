-- Fix face profile retrieval for check-in verification after RLS lock-down
-- This provides a safe RPC function to get face profile data without exposing face_profiles directly
-- Required because face_profiles is now locked behind RLS and cannot be queried directly

-- Function: Get face profile for a worker (used during check-in verification)
-- Returns: worker_id, embedding (as array), embed_model, version, image_url
-- Note: PostgREST automatically converts vector to JSON array for Flutter
CREATE OR REPLACE FUNCTION get_face_profile(p_worker_id uuid)
RETURNS TABLE (
  worker_id uuid,
  embedding vector,
  embed_model text,
  version integer,
  image_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fp.worker_id,
    fp.embedding,
    fp.embed_model,
    fp.version,
    fp.image_url
  FROM face_profiles fp
  WHERE fp.worker_id = p_worker_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_face_profile
IS 'Safely retrieves face profile data for check-in verification without exposing face_profiles directly';

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION get_face_profile(uuid) TO authenticated, anon;

