create or replace function public.capture_document_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.revision = old.revision then
    return new;
  end if;

  insert into public.document_versions (
    document_id,
    owner_id,
    revision,
    title,
    content_json,
    plain_text,
    deleted_at
  ) values (
    new.id,
    new.owner_id,
    new.revision,
    new.title,
    new.content_json,
    new.plain_text,
    new.deleted_at
  );
  return new;
end;
$$;

alter table public.documents
  add column sort_order bigint not null default 0;

with ranked as (
  select id,
    row_number() over (
      partition by owner_id, project_id
      order by updated_at desc, id
    ) - 1 as position
  from public.documents
  where deleted_at is null
)
update public.documents
set sort_order = ranked.position
from ranked
where documents.id = ranked.id;

create index documents_owner_project_order_idx
  on public.documents (owner_id, project_id, sort_order)
  where deleted_at is null;
