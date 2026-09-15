create table public.comment_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  comment_id uuid not null references public.comments(id) on delete cascade,
  source_reply_id uuid references public.comment_replies(id) on delete cascade,
  recipient_handle text not null check (
    recipient_handle = lower(recipient_handle)
    and recipient_handle ~ '^[a-z0-9_]{1,40}$'
  ),
  read_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  plan_id text check (plan_id is null or char_length(plan_id) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index comment_notifications_comment_source_idx
  on public.comment_notifications (owner_id, comment_id, recipient_handle)
  where source_reply_id is null;

create unique index comment_notifications_reply_source_idx
  on public.comment_notifications (owner_id, source_reply_id, recipient_handle)
  where source_reply_id is not null;

create index comment_notifications_inbox_idx
  on public.comment_notifications (owner_id, recipient_handle, created_at desc);

create index comment_notifications_pending_idx
  on public.comment_notifications (owner_id, recipient_handle, created_at)
  where completed_at is null;

create or replace function public.touch_comment_notification()
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

create trigger comment_notifications_touch_updated_at
before update on public.comment_notifications
for each row execute function public.touch_comment_notification();

create or replace function public.queue_comment_mentions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mention_handle text;
begin
  for mention_handle in
    select distinct lower(match[1])
    from regexp_matches(new.body, '(?i)(?:^|[^a-z0-9_])@([a-z0-9_]{1,40})', 'g') as match
  loop
    insert into public.comment_notifications (
      owner_id,
      comment_id,
      source_reply_id,
      recipient_handle,
      created_at
    ) values (
      new.owner_id,
      case when tg_table_name = 'comments' then new.id else new.comment_id end,
      case when tg_table_name = 'comment_replies' then new.id else null end,
      mention_handle,
      new.created_at
    ) on conflict do nothing;
  end loop;
  return new;
end;
$$;

create trigger comments_queue_mentions
after insert on public.comments
for each row execute function public.queue_comment_mentions();

create trigger comment_replies_queue_mentions
after insert on public.comment_replies
for each row execute function public.queue_comment_mentions();

alter table public.comment_notifications enable row level security;

revoke all on table public.comment_notifications from anon, authenticated;
grant select, insert, update on table public.comment_notifications to authenticated;

create policy "Owners can read comment notifications"
on public.comment_notifications for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create comment notifications"
on public.comment_notifications for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.comments
    where comments.id = comment_id
      and comments.owner_id = (select auth.uid())
  )
);

create policy "Owners can update comment notifications"
on public.comment_notifications for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

insert into public.comment_notifications (
  owner_id,
  comment_id,
  source_reply_id,
  recipient_handle,
  created_at
)
select
  comments.owner_id,
  comments.id,
  null,
  lower(match[1]),
  comments.created_at
from public.comments
cross join lateral regexp_matches(
  comments.body,
  '(?i)(?:^|[^a-z0-9_])@([a-z0-9_]{1,40})',
  'g'
) as match
on conflict do nothing;

insert into public.comment_notifications (
  owner_id,
  comment_id,
  source_reply_id,
  recipient_handle,
  created_at
)
select
  replies.owner_id,
  replies.comment_id,
  replies.id,
  lower(match[1]),
  replies.created_at
from public.comment_replies as replies
cross join lateral regexp_matches(
  replies.body,
  '(?i)(?:^|[^a-z0-9_])@([a-z0-9_]{1,40})',
  'g'
) as match
on conflict do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'comment_notifications'
     ) then
    alter publication supabase_realtime add table public.comment_notifications;
  end if;
end;
$$;
