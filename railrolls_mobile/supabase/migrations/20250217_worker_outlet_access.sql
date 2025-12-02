-- Allow workers to read their own worker row and related outlet for check-in.

-- Workers table: self read.
create policy workers_worker_self_read
  on public.workers
  for select
  using (auth.uid() is not null and workers.auth_id = auth.uid());

-- Outlets table: worker can read their own outlet via linked worker row.
create policy outlets_worker_read_own
  on public.outlets
  for select
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.workers w
      where w.auth_id = auth.uid()
        and w.outlet_id = outlets.id
    )
  );
