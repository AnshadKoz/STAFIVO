create or replace function public.worker_dropdown_data()
returns table (
  id text,
  name text,
  enrolled boolean
)
language sql
security definer
set search_path = public, extensions
set row_security = off
as $$
  select
    w.id::text as id,
    coalesce(w.name::text, 'Unnamed') as name,
    exists (
      select 1
      from face_profiles fp
      where fp.worker_id = w.id
        and (fp.embedding is not null or fp.image_url is not null)
    ) as enrolled
  from workers w
  order by name;
$$;

comment on function public.worker_dropdown_data() is
  'Returns worker id/name with enrollment flag. Uses security definer to bypass recursive policies.';

grant execute on function public.worker_dropdown_data() to authenticated, anon;
