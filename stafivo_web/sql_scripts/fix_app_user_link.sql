-- Fix 2: Link app_users to Auth ID correctly
-- The previous manual insert put the UUID in the 'id' column but left 'auth_id' NULL.
-- The RLS policy hides the row because 'auth_id' is missing.

UPDATE public.app_users
SET auth_id = '59360ab0-90cc-4711-889f-5011cbf96b87'
WHERE id = '59360ab0-90cc-4711-889f-5011cbf96b87';

-- Verify the result (this will only show if run as Admin in SQL Editor)
select * from public.app_users where id = '59360ab0-90cc-4711-889f-5011cbf96b87';
