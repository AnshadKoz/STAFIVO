-- Migration: Allow workers to read all outlets for outlet selection in CheckInScreen
-- Date: 2025-12-19
-- Purpose: Workers need to be able to read ALL outlets (not just their own) to populate 
--          the outlet dropdown and select which outlet they're checking in at

-- Drop the existing restrictive policy that only allows workers to read their own outlet
DROP POLICY IF EXISTS "outlets_worker_read_own" ON public.outlets;

-- Create a new policy to allow all authenticated users (including workers) to read ALL outlets
-- This is safe because outlets only contain:
--   - id, name (non-sensitive)
--   - latitude, longitude, radius_meters (location data for geofencing)
-- No sensitive business data is exposed
CREATE POLICY "outlets: authenticated users can read all"
ON public.outlets
FOR SELECT
TO authenticated
USING (true);

-- Note: The existing "outlets manager read own" policy may conflict with this.
-- If you see duplicate policy errors, you may need to drop that policy as well.
-- The new policy is more permissive and covers all authenticated users.
