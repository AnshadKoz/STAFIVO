-- =============================================================================
-- SAFE MIGRATION: Add soft-delete columns to public.workers
-- =============================================================================
--
-- What this does:
--   Adds two columns to the workers table to support soft deletion:
--     • is_deleted  boolean NOT NULL DEFAULT false
--     • deleted_at  timestamptz NULL
--
-- Safety guarantees:
--   • Uses DO $$ ... IF NOT EXISTS to skip if columns already exist.
--   • No rows are modified (ALTER TABLE ... ADD COLUMN with a DEFAULT
--     backfills all existing rows at the storage level instantly in Postgres 11+
--     without rewriting the table).
--   • No existing queries break — the columns are additive.
--   • No destructive operations (no DROP, no TRUNCATE, no UPDATE).
--
-- Run in: Supabase SQL Editor (or psql)
-- =============================================================================

DO $$
BEGIN

  -- ── Column 1: is_deleted ───────────────────────────────────────────────────
  -- boolean, NOT NULL, defaults to false.
  -- All existing rows immediately see is_deleted = false.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'workers'
      AND column_name  = 'is_deleted'
  ) THEN
    ALTER TABLE public.workers
      ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;

    RAISE NOTICE 'Column is_deleted added to public.workers.';
  ELSE
    RAISE NOTICE 'Column is_deleted already exists — skipped.';
  END IF;


  -- ── Column 2: deleted_at ───────────────────────────────────────────────────
  -- timestamptz, nullable.
  -- NULL means "not deleted". Populated when is_deleted is set to true.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'workers'
      AND column_name  = 'deleted_at'
  ) THEN
    ALTER TABLE public.workers
      ADD COLUMN deleted_at timestamptz NULL;

    RAISE NOTICE 'Column deleted_at added to public.workers.';
  ELSE
    RAISE NOTICE 'Column deleted_at already exists — skipped.';
  END IF;

END;
$$;


-- =============================================================================
-- VERIFY
-- =============================================================================
-- Run this to confirm the columns exist after migration:

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workers'
  AND column_name  IN ('is_deleted', 'deleted_at')
ORDER BY column_name;

-- Expected output:
-- column_name | data_type                   | is_nullable | column_default
-- deleted_at  | timestamp with time zone    | YES         | (null)
-- is_deleted  | boolean                     | NO          | false
-- =============================================================================
