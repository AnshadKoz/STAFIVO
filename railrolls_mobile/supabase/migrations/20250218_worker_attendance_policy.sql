-- Allow workers to insert their own attendance logs.
-- This is required because the existing policies only cover admins and managers.

create policy "attendance_logs: worker insert self"
  on public.attendance_logs
  for insert
  with check (
    -- The user must be authenticated
    auth.uid() is not null
    -- And the worker_id in the log must match the user's worker profile
    and exists (
      select 1
      from public.workers w
      where w.id = attendance_logs.worker_id
        and w.auth_id = auth.uid()
    )
  );

-- Also allow workers to read their own logs (optional but good for history)
create policy "attendance_logs: worker read self"
  on public.attendance_logs
  for select
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.workers w
      where w.id = attendance_logs.worker_id
        and w.auth_id = auth.uid()
    )
  );
