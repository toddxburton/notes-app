alter table public.projects
  add column sort_order bigint not null default 0,
  add column collapsed boolean not null default false,
  add column archived_at timestamptz;

with ranked as (
  select id,
    row_number() over (partition by owner_id order by created_at asc, id) - 1 as position
  from public.projects
)
update public.projects
set sort_order = ranked.position
from ranked
where projects.id = ranked.id;

create index projects_owner_order_idx
  on public.projects (owner_id, sort_order)
  where archived_at is null;

alter table public.documents
  add column archived_at timestamptz;

create index documents_owner_archived_idx
  on public.documents (owner_id, archived_at, sort_order)
  where deleted_at is null;
