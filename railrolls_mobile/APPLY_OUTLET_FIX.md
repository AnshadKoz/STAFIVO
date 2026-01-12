# How to Apply the Outlet RLS Fix

## Problem
Workers cannot select outlets in the CheckInScreen because the RLS policy `outlets_worker_read_own` only allows them to read their assigned outlet, not all outlets.

## Solution
Run the migration file: `supabase/migrations/20251219_outlets_worker_read.sql`

## Option 1: Using Supabase CLI (Recommended)
```bash
# Navigate to the mobile project directory
cd c:\Anshad_Work\Rail-Rolls Project\Rail_Rolls_Project\railrolls_mobile

# Run the migration
supabase db push
```

## Option 2: Using Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase/migrations/20251219_outlets_worker_read.sql`
4. Click **Run**

## Option 3: Direct SQL Execution
If you have direct database access, run this SQL:

```sql
-- Drop the restrictive policy
DROP POLICY IF EXISTS "outlets_worker_read_own" ON public.outlets;

-- Create permissive policy for all authenticated users
CREATE POLICY "outlets: authenticated users can read all"
ON public.outlets
FOR SELECT
TO authenticated
USING (true);
```

## After Applying
1. Hot restart the Flutter app (press `r` in the terminal where `flutter run` is running)
2. Navigate to CheckInScreen
3. The outlet dropdown should now be enabled and populated with all outlets

## Verification
Check the debug console for these messages:
- `DEBUG loaded X outlets` (where X > 0)
- No errors about permissions or RLS
