-- ROBUST Fix for Missing Worker Auth IDs
-- The previous fix might have failed if emails had different casing (e.g. 'User@Test.com' vs 'user@test.com').
-- This script matches strictly by LOWERCASE email and updates NULL auth_ids.

BEGIN;

-- 1. Update workers with case-insensitive match
UPDATE public.workers
SET auth_id = auth.users.id
FROM auth.users
WHERE LOWER(public.workers.email) = LOWER(auth.users.email)
  AND public.workers.auth_id IS NULL;

-- 2. Verification Query (Run this to see if any are still missing)
-- This will return any workers that exist but are NOT linked to an auth user.
-- If this returns 0 rows, you are 100% fixed.
SELECT id, name, email, auth_id, 'STILL_MISSING_AUTH' as status
FROM public.workers
WHERE auth_id IS NULL;

COMMIT;
