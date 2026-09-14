create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_created_idx on public.projects (owner_id, created_at);

alter table public.documents
  add column project_id uuid references public.projects(id) on delete set null;

create index documents_project_updated_idx
  on public.documents (project_id, updated_at desc)
  where deleted_at is null;

create or replace function public.touch_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function public.touch_project();

alter table public.projects enable row level security;
revoke all on table public.projects from anon, authenticated;
grant select, insert, update on table public.projects to authenticated;

create policy "Owners can read projects"
on public.projects for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create projects"
on public.projects for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Owners can update projects"
on public.projects for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'projects'
     ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end;
$$;
