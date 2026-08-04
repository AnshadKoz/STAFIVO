-- Fix face enrollment RLS and helper functions.
-- - Rewrites helpers to avoid recursive lookups.
-- - Simplifies face_profiles policies to prevent stack depth recursion.
-- - Adds bucket-specific policies for faces storage uploads.

-- Helper: current user role (admin/manager/worker); null when unknown.
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public, auth
set row_security = off
as $$
  select role
  from public.app_users
  where id = auth.uid()
  limit 1;
$$;

comment on function public.current_user_role() is 'Returns app_users.role for auth.uid(); security definer to bypass RLS.';

-- Helper: outlet for the current app user (used by managers).
create or replace function public.my_outlet_id()
returns uuid
language sql
security definer
set search_path = public, auth
set row_security = off
as $$
  select outlet_id
  from public.app_users
  where id = auth.uid()
  limit 1;
$$;

comment on function public.my_outlet_id() is 'Returns outlet_id for auth.uid(); security definer to avoid recursive policies.';

-- Face profiles: drop old policies to avoid recursive logic.
drop policy if exists "face_profiles: admin full" on public.face_profiles;
drop policy if exists "face_profiles: manager insert outlet" on public.face_profiles;
drop policy if exists "face_profiles: manager read outlet" on public.face_profiles;
drop policy if exists "face_profiles: manager update outlet" on public.face_profiles;

-- Admin: full read/write on face profiles.
create policy face_profiles_admin_full
  on public.face_profiles
  for all
  using (current_user_role() = 'admin'::public.user_role)
  with check (current_user_role() = 'admin'::public.user_role);

-- Manager: read workers in own outlet.
create policy face_profiles_manager_read
  on public.face_profiles
  for select
  using (
    current_user_role() = 'manager'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.outlet_id = my_outlet_id()
    )
  );

create policy face_profiles_manager_insert
  on public.face_profiles
  for insert
  with check (
    current_user_role() = 'manager'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.outlet_id = my_outlet_id()
    )
  );

create policy face_profiles_manager_update
  on public.face_profiles
  for update
  using (
    current_user_role() = 'manager'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.outlet_id = my_outlet_id()
    )
  )
  with check (
    current_user_role() = 'manager'::public.user_role
    and
    exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.outlet_id = my_outlet_id()
    )
  );

-- Worker: self read/write (for enrollment and updates).
create policy face_profiles_worker_select
  on public.face_profiles
  for select
  using (
    current_user_role() = 'worker'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.auth_id = auth.uid()
    )
  );

create policy face_profiles_worker_insert
  on public.face_profiles
  for insert
  with check (
    current_user_role() = 'worker'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.auth_id = auth.uid()
    )
  );

create policy face_profiles_worker_update
  on public.face_profiles
  for update
  using (
    current_user_role() = 'worker'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.auth_id = auth.uid()
    )
  )
  with check (
    current_user_role() = 'worker'::public.user_role
    and
    exists (
      select 1
      from public.workers w
      where w.id = face_profiles.worker_id
        and w.auth_id = auth.uid()
    )
  );

-- Storage: bucket-specific policies for faces uploads.
-- Admin: full control of faces bucket.
create policy faces_admin_full
  on storage.objects
  for all
  using (
    bucket_id = 'faces'
    and current_user_role() = 'admin'::public.user_role
  )
  with check (
    bucket_id = 'faces'
    and current_user_role() = 'admin'::public.user_role
  );

-- Manager: manage files for workers in own outlet.
create policy faces_manager_outlet
  on storage.objects
  for all
  using (
    bucket_id = 'faces'
    and current_user_role() = 'manager'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.outlet_id = my_outlet_id()
        and storage.objects.name like ('workers/' || w.id || '/%')
    )
  )
  with check (
    bucket_id = 'faces'
    and current_user_role() = 'manager'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.outlet_id = my_outlet_id()
        and storage.objects.name like ('workers/' || w.id || '/%')
    )
  );

-- Worker: manage their own folder in faces bucket.
create policy faces_worker_self
  on storage.objects
  for all
  using (
    bucket_id = 'faces'
    and current_user_role() = 'worker'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.auth_id = auth.uid()
        and storage.objects.name like ('workers/' || w.id || '/%')
    )
  )
  with check (
    bucket_id = 'faces'
    and current_user_role() = 'worker'::public.user_role
    and exists (
      select 1
      from public.workers w
      where w.auth_id = auth.uid()
        and storage.objects.name like ('workers/' || w.id || '/%')
    )
  );

-- Smoke-test to ensure face_profiles can be read without recursion.
do $$
begin
  perform 1 from public.face_profiles limit 1;
end;
$$;
