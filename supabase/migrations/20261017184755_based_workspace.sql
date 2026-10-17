create table public.based_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  sort_order bigint not null default 0,
  collapsed boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.based_databases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid,
  name text not null check (char_length(name) between 1 and 180),
  sort_order bigint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (folder_id, owner_id) references public.based_folders(id, owner_id)
);

create table public.based_tables (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  database_id uuid not null,
  name text not null check (char_length(name) between 1 and 180),
  sort_order bigint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, database_id, owner_id),
  foreign key (database_id, owner_id) references public.based_databases(id, owner_id) on delete cascade
);

create table public.based_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  database_id uuid not null,
  left_table_id uuid not null,
  right_table_id uuid not null,
  unique (id, owner_id),
  foreign key (left_table_id, database_id, owner_id) references public.based_tables(id, database_id, owner_id) on delete cascade,
  foreign key (right_table_id, database_id, owner_id) references public.based_tables(id, database_id, owner_id) on delete cascade
);

create table public.based_fields (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid not null,
  name text not null check (char_length(name) between 1 and 180),
  type text not null check (type in ('itemName', 'text', 'number', 'date', 'singleSelect', 'multiSelect', 'url', 'checkbox', 'linkedRecord')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  relation_id uuid,
  relation_side text check (relation_side in ('left', 'right')),
  width integer check (width between 120 and 420),
  hidden boolean not null default false,
  archived_at timestamptz,
  sort_order bigint not null default 0,
  unique (id, owner_id),
  unique (relation_id, relation_side),
  foreign key (table_id, owner_id) references public.based_tables(id, owner_id) on delete cascade,
  foreign key (relation_id, owner_id) references public.based_relations(id, owner_id) on delete cascade,
  check ((type = 'linkedRecord') = (relation_id is not null and relation_side is not null))
);

create table public.based_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid not null,
  cells jsonb not null default '{}'::jsonb check (jsonb_typeof(cells) = 'object'),
  sort_order bigint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, table_id, owner_id),
  foreign key (table_id, owner_id) references public.based_tables(id, owner_id) on delete cascade
);

create table public.based_links (
  relation_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  left_record_id uuid not null,
  right_record_id uuid not null,
  primary key (relation_id, left_record_id, right_record_id),
  foreign key (relation_id, owner_id) references public.based_relations(id, owner_id) on delete cascade,
  foreign key (left_record_id, owner_id) references public.based_records(id, owner_id) on delete cascade,
  foreign key (right_record_id, owner_id) references public.based_records(id, owner_id) on delete cascade
);

create table public.based_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  format_version integer not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index based_databases_owner_folder_idx on public.based_databases (owner_id, folder_id, sort_order);
create index based_tables_database_idx on public.based_tables (database_id, sort_order);
create index based_fields_table_idx on public.based_fields (table_id, sort_order);
create index based_records_table_order_idx on public.based_records (table_id, sort_order, id) where archived_at is null;
create index based_records_cells_idx on public.based_records using gin (cells jsonb_path_ops);
create index based_links_right_idx on public.based_links (relation_id, right_record_id);
create index based_backups_owner_created_idx on public.based_backups (owner_id, created_at desc);

create function public.based_check_field_relation() returns trigger language plpgsql security invoker set search_path = '' as $$
declare relation_row public.based_relations;
begin
  if new.relation_id is null then return new; end if;
  select * into relation_row from public.based_relations where id = new.relation_id and owner_id = new.owner_id;
  if not found or (new.relation_side = 'left' and new.table_id is distinct from relation_row.left_table_id)
    or (new.relation_side = 'right' and new.table_id is distinct from relation_row.right_table_id) then
    raise exception 'Linked field must belong to its relation table';
  end if;
  return new;
end;
$$;
create trigger based_fields_check_relation before insert or update on public.based_fields
for each row execute function public.based_check_field_relation();

create function public.based_check_link() returns trigger language plpgsql security invoker set search_path = '' as $$
declare relation_row public.based_relations;
begin
  select * into relation_row from public.based_relations where id = new.relation_id and owner_id = new.owner_id;
  if not found
     or not exists (select 1 from public.based_records where id = new.left_record_id and table_id = relation_row.left_table_id and owner_id = new.owner_id)
     or not exists (select 1 from public.based_records where id = new.right_record_id and table_id = relation_row.right_table_id and owner_id = new.owner_id) then
    raise exception 'Linked records must match the relation tables';
  end if;
  return new;
end;
$$;
create trigger based_links_check before insert or update on public.based_links
for each row execute function public.based_check_link();

create function public.based_touch_record() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger based_records_touch before update on public.based_records
for each row execute function public.based_touch_record();

alter table public.based_folders enable row level security;
alter table public.based_databases enable row level security;
alter table public.based_tables enable row level security;
alter table public.based_relations enable row level security;
alter table public.based_fields enable row level security;
alter table public.based_records enable row level security;
alter table public.based_links enable row level security;
alter table public.based_backups enable row level security;

revoke all on public.based_folders, public.based_databases, public.based_tables, public.based_relations,
  public.based_fields, public.based_records, public.based_links, public.based_backups from anon, authenticated;
grant select, insert, update, delete on public.based_folders, public.based_databases, public.based_tables,
  public.based_relations, public.based_fields, public.based_records, public.based_links to authenticated;
grant select, insert on public.based_backups to authenticated;
grant select, insert, update, delete on public.based_folders, public.based_databases, public.based_tables,
  public.based_relations, public.based_fields, public.based_records, public.based_links, public.based_backups to service_role;

create policy "Owner access" on public.based_folders for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_databases for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_tables for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_relations for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_fields for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_records for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_links for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner access" on public.based_backups for select to authenticated
using ((select auth.uid()) = owner_id);
create policy "Owner insert" on public.based_backups for insert to authenticated
with check ((select auth.uid()) = owner_id);

create function public.based_query_records(
  p_table_id uuid,
  p_search text default '',
  p_filter_field_id uuid default null,
  p_filter_mode text default null,
  p_filter_value text default '',
  p_sort_field_id uuid default null,
  p_descending boolean default false,
  p_group_field_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 100
) returns table (record jsonb, total_count bigint)
language plpgsql security invoker set search_path = '' as $$
declare
  sql text;
  field_id uuid;
  sort_type text;
  filter_type text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 100 then raise exception 'Invalid page'; end if;
  if p_filter_mode is not null and p_filter_mode not in ('contains', 'equals', 'empty', 'notEmpty') then
    raise exception 'Invalid filter';
  end if;
  foreach field_id in array array[p_filter_field_id, p_sort_field_id, p_group_field_id] loop
    if field_id is not null and not exists (
      select 1 from public.based_fields where id = field_id and table_id = p_table_id
        and owner_id = (select auth.uid()) and archived_at is null
    ) then raise exception 'Field does not belong to table'; end if;
  end loop;

  sql := 'select to_jsonb(r), count(*) over() from public.based_records r'
    || ' where r.owner_id = $1 and r.table_id = $2 and r.archived_at is null';
  if coalesce(p_search, '') <> '' then
    sql := sql || $fragment$ and exists (
      select 1 from jsonb_each_text(r.cells) as cell(field_id, value)
      where cell.value ilike '%' || $3 || '%'
    ) $fragment$;
  end if;
  if p_filter_field_id is not null and p_filter_mode is not null then
    select type into filter_type from public.based_fields where id = p_filter_field_id;
    case p_filter_mode
      when 'empty' then sql := sql || format($fragment$ and coalesce(r.cells->>%L, '') = ''$fragment$, p_filter_field_id::text);
      when 'notEmpty' then sql := sql || format($fragment$ and coalesce(r.cells->>%L, '') <> ''$fragment$, p_filter_field_id::text);
      when 'equals' then
        if filter_type = 'multiSelect' then
          sql := sql || format($fragment$ and exists (select 1 from jsonb_array_elements_text(
            case when jsonb_typeof(r.cells->%L) = 'array' then r.cells->%L else '[]'::jsonb end
          ) as options(value) where lower(options.value) = lower($4))$fragment$,
            p_filter_field_id::text, p_filter_field_id::text);
        else
          sql := sql || format($fragment$ and lower(coalesce(r.cells->>%L, '')) = lower($4)$fragment$, p_filter_field_id::text);
        end if;
      when 'contains' then sql := sql || format($fragment$ and r.cells->>%L ilike '%%' || $4 || '%%'$fragment$, p_filter_field_id::text);
    end case;
  end if;
  sql := sql || ' order by ';
  if p_group_field_id is not null then
    sql := sql || format($fragment$coalesce(r.cells->>%L, '') asc, $fragment$, p_group_field_id::text);
  end if;
  if p_sort_field_id is not null then
    select type into sort_type from public.based_fields where id = p_sort_field_id;
    if sort_type = 'number' then
      sql := sql || format($fragment$case when r.cells->>%L ~ '^[-+]?[0-9]+([.][0-9]+)?$'
        then (r.cells->>%L)::numeric end %s nulls last, $fragment$,
        p_sort_field_id::text, p_sort_field_id::text, case when p_descending then 'desc' else 'asc' end);
    else
      sql := sql || format($fragment$coalesce(r.cells->>%L, '') %s, $fragment$, p_sort_field_id::text,
        case when p_descending then 'desc' else 'asc' end);
    end if;
  end if;
  sql := sql || 'r.sort_order asc, r.id asc limit $5 offset $6';
  return query execute sql using (select auth.uid()), p_table_id, coalesce(p_search, ''), coalesce(p_filter_value, ''), p_limit, p_offset;
end;
$$;
revoke all on function public.based_query_records(uuid, text, uuid, text, text, uuid, boolean, uuid, integer, integer) from public, anon;
grant execute on function public.based_query_records(uuid, text, uuid, text, text, uuid, boolean, uuid, integer, integer) to authenticated;

create function public.based_create_relation(
  p_owner_id uuid, p_database_id uuid, p_left_table_id uuid, p_right_table_id uuid,
  p_name text, p_left_order bigint, p_right_order bigint
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  created_relation public.based_relations;
  left_field public.based_fields;
  right_field public.based_fields;
begin
  if current_user <> 'service_role' then
    if (select auth.uid()) is distinct from p_owner_id then
      raise exception 'Not authorized to create this relation';
    end if;
  end if;
  if char_length(trim(p_name)) not between 1 and 180 then raise exception 'Invalid column name'; end if;
  if not exists (
    select 1 from public.based_databases where id = p_database_id and owner_id = p_owner_id and archived_at is null
  ) or not exists (
    select 1 from public.based_tables where id = p_left_table_id and database_id = p_database_id
      and owner_id = p_owner_id and archived_at is null
  ) or not exists (
    select 1 from public.based_tables where id = p_right_table_id and database_id = p_database_id
      and owner_id = p_owner_id and archived_at is null
  ) then raise exception 'Linked tables must belong to the same active database'; end if;

  insert into public.based_relations (owner_id, database_id, left_table_id, right_table_id)
    values (p_owner_id, p_database_id, p_left_table_id, p_right_table_id) returning * into created_relation;
  insert into public.based_fields (owner_id, table_id, name, type, relation_id, relation_side, sort_order)
    values (p_owner_id, p_left_table_id, trim(p_name), 'linkedRecord', created_relation.id, 'left', p_left_order)
    returning * into left_field;
  insert into public.based_fields (owner_id, table_id, name, type, relation_id, relation_side, sort_order)
    values (p_owner_id, p_right_table_id, left('Linked from ' || trim(p_name), 180), 'linkedRecord',
      created_relation.id, 'right', p_right_order) returning * into right_field;
  return jsonb_build_object('relation', to_jsonb(created_relation),
    'fields', jsonb_build_array(to_jsonb(left_field), to_jsonb(right_field)));
end;
$$;
revoke all on function public.based_create_relation(uuid, uuid, uuid, uuid, text, bigint, bigint) from public, anon;
grant execute on function public.based_create_relation(uuid, uuid, uuid, uuid, text, bigint, bigint) to authenticated, service_role;

create function public.based_merge_record_cells(p_record_id uuid, p_cells jsonb)
returns public.based_records language plpgsql security invoker set search_path = '' as $$
declare updated public.based_records;
begin
  if jsonb_typeof(p_cells) is distinct from 'object' then raise exception 'Cells must be an object'; end if;
  update public.based_records set cells = cells || p_cells
    where id = p_record_id and owner_id = (select auth.uid()) and archived_at is null
    returning * into updated;
  if not found then raise exception 'Record not found'; end if;
  return updated;
end;
$$;
revoke all on function public.based_merge_record_cells(uuid, jsonb) from public, anon;
grant execute on function public.based_merge_record_cells(uuid, jsonb) to authenticated;

create function public.based_merge_record_cells_admin(p_owner_id uuid, p_record_id uuid, p_cells jsonb)
returns public.based_records language plpgsql security invoker set search_path = '' as $$
declare updated public.based_records;
begin
  if jsonb_typeof(p_cells) is distinct from 'object' then raise exception 'Cells must be an object'; end if;
  update public.based_records set cells = cells || p_cells
    where id = p_record_id and owner_id = p_owner_id and archived_at is null
    returning * into updated;
  if not found then raise exception 'Record not found'; end if;
  return updated;
end;
$$;
revoke all on function public.based_merge_record_cells_admin(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.based_merge_record_cells_admin(uuid, uuid, jsonb) to service_role;

create function public.based_restore(p_backup jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare current_owner uuid := (select auth.uid());
begin
  if current_owner is null then raise exception 'Sign in required'; end if;
  if p_backup->>'format' is distinct from 'based-workspace' or (p_backup->>'version')::integer is distinct from 1 then
    raise exception 'Unsupported Based backup';
  end if;
  if jsonb_typeof(p_backup->'folders') is distinct from 'array'
     or jsonb_typeof(p_backup->'databases') is distinct from 'array'
     or jsonb_typeof(p_backup->'tables') is distinct from 'array'
     or jsonb_typeof(p_backup->'fields') is distinct from 'array'
     or jsonb_typeof(p_backup->'relations') is distinct from 'array'
     or jsonb_typeof(p_backup->'records') is distinct from 'array'
     or jsonb_typeof(p_backup->'links') is distinct from 'array' then
    raise exception 'Incomplete Based backup';
  end if;

  delete from public.based_databases where owner_id = current_owner;
  delete from public.based_folders where owner_id = current_owner;

  insert into public.based_folders (id, owner_id, name, sort_order, collapsed, archived_at, created_at)
  select id, current_owner, name, sort_order, coalesce(collapsed, false), archived_at, created_at
  from jsonb_to_recordset(p_backup->'folders') as x(id uuid, name text, sort_order bigint, collapsed boolean,
    archived_at timestamptz, created_at timestamptz);

  insert into public.based_databases (id, owner_id, folder_id, name, sort_order, archived_at, created_at)
  select id, current_owner, folder_id, name, sort_order, archived_at, created_at
  from jsonb_to_recordset(p_backup->'databases') as x(id uuid, folder_id uuid, name text, sort_order bigint, archived_at timestamptz, created_at timestamptz);

  insert into public.based_tables (id, owner_id, database_id, name, sort_order, archived_at, created_at)
  select id, current_owner, database_id, name, sort_order, archived_at, created_at
  from jsonb_to_recordset(p_backup->'tables') as x(id uuid, database_id uuid, name text, sort_order bigint, archived_at timestamptz, created_at timestamptz);

  insert into public.based_relations (id, owner_id, database_id, left_table_id, right_table_id)
  select id, current_owner, database_id, left_table_id, right_table_id
  from jsonb_to_recordset(p_backup->'relations') as x(id uuid, database_id uuid, left_table_id uuid, right_table_id uuid);

  insert into public.based_fields (id, owner_id, table_id, name, type, options, relation_id, relation_side, width, hidden, archived_at, sort_order)
  select id, current_owner, table_id, name, type, options, relation_id, relation_side, width, hidden, archived_at, sort_order
  from jsonb_to_recordset(p_backup->'fields') as x(id uuid, table_id uuid, name text, type text, options jsonb,
    relation_id uuid, relation_side text, width integer, hidden boolean, archived_at timestamptz, sort_order bigint);

  insert into public.based_records (id, owner_id, table_id, cells, sort_order, archived_at, created_at, updated_at)
  select id, current_owner, table_id, cells, sort_order, archived_at, created_at, updated_at
  from jsonb_to_recordset(p_backup->'records') as x(id uuid, table_id uuid, cells jsonb, sort_order bigint,
    archived_at timestamptz, created_at timestamptz, updated_at timestamptz);

  insert into public.based_links (relation_id, owner_id, left_record_id, right_record_id)
  select relation_id, current_owner, left_record_id, right_record_id
  from jsonb_to_recordset(p_backup->'links') as x(relation_id uuid, left_record_id uuid, right_record_id uuid);
end;
$$;
revoke all on function public.based_restore(jsonb) from public, anon;
grant execute on function public.based_restore(jsonb) to authenticated;
