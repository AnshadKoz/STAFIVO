# Enrollment Status Fix - Instructions

## 🐛 Problem Fixed

After locking down `face_profiles` with RLS, the UI incorrectly showed workers as "Unenrolled" even after successful enrollment because:
- Direct SELECT queries on `face_profiles` are blocked by RLS
- Flutter code was using LEFT JOIN which couldn't see the data
- Enrollment succeeded (RPC worked), but UI couldn't detect it

## ✅ Solution

Created SECURITY DEFINER RPC functions that can read `face_profiles` internally and return only enrollment status (boolean) without exposing sensitive biometric data.

---

## 📋 What to Run in Supabase SQL Editor

### Step 1: Open Supabase SQL Editor
1. Go to Supabase Dashboard
2. Navigate to **SQL Editor** → **New Query**

### Step 2: Run the Migration SQL

Copy and paste the **ENTIRE** contents of:
`supabase/migrations/20250220_fix_enrollment_status_rls.sql`

**OR** copy this SQL directly:

```sql
-- Fix enrollment status detection after RLS lock-down
-- This provides safe RPC functions to check enrollment status without exposing face_profiles
-- Required because face_profiles is now locked behind RLS and cannot be queried directly

-- Function 1: Get workers by outlet with enrollment status
-- Returns: id, name, enrolled (boolean)
CREATE OR REPLACE FUNCTION workers_by_outlet_with_enrollment(
  p_outlet_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  enrolled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    EXISTS (
      SELECT 1
      FROM face_profiles fp
      WHERE fp.worker_id = w.id
    ) AS enrolled
  FROM workers w
  WHERE w.outlet_id = p_outlet_id
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_by_outlet_with_enrollment
IS 'Returns workers for an outlet with safe enrollment status without exposing face_profiles';

-- Function 2: Get all workers with enrollment status (for general dropdown)
-- Returns: id, name, enrolled (boolean)
CREATE OR REPLACE FUNCTION workers_with_enrollment()
RETURNS TABLE (
  id uuid,
  name text,
  enrolled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    EXISTS (
      SELECT 1
      FROM face_profiles fp
      WHERE fp.worker_id = w.id
    ) AS enrolled
  FROM workers w
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_with_enrollment
IS 'Returns all workers with safe enrollment status without exposing face_profiles';

-- Function 3: Get workers needing enrollment (no face profile exists)
-- Returns: id, name
CREATE OR REPLACE FUNCTION workers_needing_enrollment()
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name
  FROM workers w
  WHERE NOT EXISTS (
    SELECT 1
    FROM face_profiles fp
    WHERE fp.worker_id = w.id
  )
  ORDER BY w.name;
$$;

COMMENT ON FUNCTION workers_needing_enrollment
IS 'Returns workers who need face enrollment (no face profile exists)';

-- Function 4: Get enrolled worker IDs only
-- Returns: worker_id (uuid)
CREATE OR REPLACE FUNCTION enrolled_worker_ids()
RETURNS TABLE (
  worker_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fp.worker_id
  FROM face_profiles fp;
$$;

COMMENT ON FUNCTION enrolled_worker_ids
IS 'Returns list of worker IDs who have face profiles enrolled';

-- Grant execute permissions to authenticated and anon users
GRANT EXECUTE ON FUNCTION workers_by_outlet_with_enrollment(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION workers_with_enrollment() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION workers_needing_enrollment() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION enrolled_worker_ids() TO authenticated, anon;
```

### Step 3: Verify Success

After running, verify functions exist:
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'workers_by_outlet_with_enrollment',
  'workers_with_enrollment',
  'workers_needing_enrollment',
  'enrolled_worker_ids'
);
```

You should see all 4 function names.

---

## 🔧 Flutter Code Changes (Already Done)

The following functions have been updated in `lib/services/supabase_repo.dart`:

### ✅ Updated Functions:

1. **`workersByOutlet()`** - Now uses `workers_by_outlet_with_enrollment` RPC
2. **`workerDropdown()`** - Now uses `workers_with_enrollment` RPC
3. **`workersNeedingEnrollmentFallback()`** - Now uses `workers_needing_enrollment` RPC
4. **`enrolledWorkerIds()`** - Now uses `enrolled_worker_ids` RPC

### Before (Broken):
```dart
// ❌ This fails because face_profiles is locked by RLS
.from('workers')
.select('id, name, face_profiles!left(worker_id)')
```

### After (Fixed):
```dart
// ✅ This works - RPC function has SECURITY DEFINER access
await sb.rpc('workers_by_outlet_with_enrollment', params: {'p_outlet_id': outletId});
```

---

## 🛡️ Security Impact

| Area | Status |
|------|--------|
| **Duplicate face prevention** | ✅ SAFE |
| **Face embeddings exposed** | ❌ NEVER |
| **RLS on face_profiles** | ✅ STRICT |
| **UI enrollment detection** | ✅ FIXED |
| **Attendance / verification** | ✅ UNCHANGED |
| **Existing enrolled faces** | ✅ WORK |

---

## 🧪 Testing

After running the SQL:

1. **Enroll a face** → Should succeed ✅
2. **Check worker dropdown** → Should show "Enrolled" (not "Unenrolled") ✅
3. **Check-in screen** → Should show correct enrollment status ✅
4. **Try duplicate face** → Should be rejected with alert ✅

---

## 📝 What Changed

### SQL Functions Created:
- `workers_by_outlet_with_enrollment(p_outlet_id)` - For outlet-filtered workers
- `workers_with_enrollment()` - For all workers dropdown
- `workers_needing_enrollment()` - For enrollment screen
- `enrolled_worker_ids()` - For checking enrolled IDs

### Flutter Code Updated:
- `lib/services/supabase_repo.dart` - All enrollment status queries now use RPC

---

## ✅ Final Checklist

- [ ] SQL migration executed successfully
- [ ] All 4 RPC functions exist
- [ ] Flutter app code updated (already done)
- [ ] Test: Enroll face → UI shows "Enrolled" ✅
- [ ] Test: Worker dropdown shows correct status ✅
- [ ] Test: Check-in screen works ✅

---

## 🎯 Why This is the Correct Architecture

This follows enterprise-grade biometric security patterns:

🔐 **Raw biometric data** → Never readable by clients  
🔎 **Enrollment status** → Boolean only, via SECURITY DEFINER  
🧠 **Face matching** → Server-side only  
📱 **Client** → Minimal, safe, no direct access to sensitive data  

Your app now has **production-grade security**! 🚀


