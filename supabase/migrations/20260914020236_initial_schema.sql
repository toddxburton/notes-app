create extension if not exists pgcrypto;

create table public.workspace_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'You' check (char_length(display_name) between 1 and 40),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  plain_text text not null default '',
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index documents_owner_updated_idx
  on public.documents (owner_id, updated_at desc)
  where deleted_at is null;

create index documents_search_idx
  on public.documents using gin (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(plain_text, ''))
  );

create table public.document_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  title text not null,
  content_json jsonb not null,
  plain_text text not null,
  deleted_at timestamptz,
  saved_at timestamptz not null default now(),
  unique (document_id, revision)
);

create index document_versions_document_idx
  on public.document_versions (document_id, revision desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  exact_quote text not null check (char_length(exact_quote) between 1 and 20000),
  occurrence integer not null default 1 check (occurrence > 0),
  prefix text not null default '' check (char_length(prefix) <= 500),
  suffix text not null default '' check (char_length(suffix) <= 500),
  author_name text not null default 'You' check (char_length(author_name) between 1 and 40),
  status text not null default 'open' check (status in ('open', 'resolved')),
  detached boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_document_status_idx
  on public.comments (document_id, status, created_at);

create table public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  author_name text not null default 'You' check (char_length(author_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create index comment_replies_comment_idx
  on public.comment_replies (comment_id, created_at);

create table public.workspace_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  format_version integer not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index workspace_backups_owner_created_idx
  on public.workspace_backups (owner_id, created_at desc);

create or replace function public.touch_workspace_settings()
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

create trigger workspace_settings_touch_updated_at
before update on public.workspace_settings
for each row execute function public.touch_workspace_settings();

create or replace function public.prepare_document_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.title is distinct from old.title
     or new.content_json is distinct from old.content_json
     or new.plain_text is distinct from old.plain_text
     or new.deleted_at is distinct from old.deleted_at then
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger documents_prepare_update
before update on public.documents
for each row execute function public.prepare_document_update();

create or replace function public.capture_document_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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

create trigger documents_capture_version
after insert or update on public.documents
for each row execute function public.capture_document_version();

create or replace function public.touch_comment()
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

create trigger comments_touch_updated_at
before update on public.comments
for each row execute function public.touch_comment();

alter table public.workspace_settings enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.comments enable row level security;
alter table public.comment_replies enable row level security;
alter table public.workspace_backups enable row level security;

revoke all on table public.workspace_settings from anon, authenticated;
revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_versions from anon, authenticated;
revoke all on table public.comments from anon, authenticated;
revoke all on table public.comment_replies from anon, authenticated;
revoke all on table public.workspace_backups from anon, authenticated;

grant select, insert, update on table public.workspace_settings to authenticated;
grant select, insert, update on table public.documents to authenticated;
grant select, insert on table public.document_versions to authenticated;
grant select, insert, update on table public.comments to authenticated;
grant select, insert on table public.comment_replies to authenticated;
grant select, insert on table public.workspace_backups to authenticated;

create policy "Owners can read workspace settings"
on public.workspace_settings for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Owners can create workspace settings"
on public.workspace_settings for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owners can update workspace settings"
on public.workspace_settings for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Owners can read documents"
on public.documents for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create documents"
on public.documents for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Owners can update documents"
on public.documents for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can read document versions"
on public.document_versions for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create document versions"
on public.document_versions for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.documents
    where documents.id = document_id
      and documents.owner_id = (select auth.uid())
  )
);

create policy "Owners can read comments"
on public.comments for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create comments"
on public.comments for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.documents
    where documents.id = document_id
      and documents.owner_id = (select auth.uid())
  )
);

create policy "Owners can update comments"
on public.comments for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can read comment replies"
on public.comment_replies for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create comment replies"
on public.comment_replies for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.comments
    where comments.id = comment_id
      and comments.owner_id = (select auth.uid())
  )
);

create policy "Owners can read workspace backups"
on public.workspace_backups for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create workspace backups"
on public.workspace_backups for insert
to authenticated
with check ((select auth.uid()) = owner_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'documents'
    ) then
      alter publication supabase_realtime add table public.documents;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'comments'
    ) then
      alter publication supabase_realtime add table public.comments;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'comment_replies'
    ) then
      alter publication supabase_realtime add table public.comment_replies;
    end if;
  end if;
end;
$$;
