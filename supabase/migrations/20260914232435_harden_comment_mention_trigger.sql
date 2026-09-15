create or replace function public.queue_comment_mentions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mention_handle text;
  source_comment_id uuid;
  source_reply_id uuid;
begin
  if tg_table_name = 'comments' then
    source_comment_id := new.id;
    source_reply_id := null;
  elsif tg_table_name = 'comment_replies' then
    source_comment_id := (to_jsonb(new) ->> 'comment_id')::uuid;
    source_reply_id := new.id;
  else
    raise exception 'Unsupported mention source table: %', tg_table_name;
  end if;

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
      source_comment_id,
      source_reply_id,
      mention_handle,
      new.created_at
    ) on conflict do nothing;
  end loop;
  return new;
end;
$$;
