-- Fix infinite recursion in is_admin() by adding SECURITY DEFINER.
-- This prevents the function from triggering RLS policies on app_users when it queries that table.

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_users au WHERE au.id = auth.uid() AND au.role = 'admin'
  );
$function$;

COMMENT ON FUNCTION public.is_admin() IS 'Checks if the current user is an admin. Uses SECURITY DEFINER to avoid RLS recursion.';
