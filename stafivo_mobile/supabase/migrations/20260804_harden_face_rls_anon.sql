-- Revoke all privileges from anon on face_profiles table
REVOKE ALL ON public.face_profiles FROM anon;

-- Ensure service_role has full access (default, but explicit)
GRANT ALL ON public.face_profiles TO service_role;
