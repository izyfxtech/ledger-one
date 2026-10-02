-- LedgerOne cloud sync.
--
-- One generic table of per-user "entities" (a transaction, an account, an FX
-- rate, ...). Each device keeps a full local copy (SQLite on desktop,
-- IndexedDB on the web) and syncs by pushing the entities it changed and
-- pulling everything newer than a per-user cursor.
--
--  * Conflicts: last-writer-wins per entity, using the writer's timestamp
--    (clamped so a wrong clock can't win forever).
--  * Deletes are tombstone rows, so other devices learn about them.
--  * Pull ordering uses a per-user counter bumped under a row lock, so
--    sequence order == commit order for one user's writes. A global sequence
--    can't promise that, and a cursor over it can skip rows.
--  * The table is writable only through push_ledger_entities(); clients get
--    SELECT only, and only on their own rows (RLS).

create table if not exists public.ledger_entities (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null
             check (kind in ('domain','object','category','allocation','goal',
                             'budget','transaction','fx','settings','currencies')),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  server_seq bigint      not null default 0,
  primary key (user_id, kind, id),
  constraint ledger_entities_tombstone_has_no_payload
    check ((deleted and data is null) or (not deleted and data is not null)),
  constraint ledger_entities_payload_size
    check (data is null or pg_column_size(data) <= 1048576)
);

create index if not exists ledger_entities_pull_idx
  on public.ledger_entities (user_id, server_seq);

create table if not exists public.ledger_cursors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seq     bigint not null default 0
);

alter table public.ledger_entities enable row level security;
alter table public.ledger_cursors  enable row level security;

drop policy if exists "read own entities" on public.ledger_entities;
create policy "read own entities" on public.ledger_entities
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No policy on ledger_cursors: it is only touched by the trigger below.

revoke all on public.ledger_entities from public, anon, authenticated;
revoke all on public.ledger_cursors  from public, anon, authenticated;
grant select on public.ledger_entities to authenticated;

-- Assign the next per-user sequence number on every insert/update.
create or replace function public.ledger_entities_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ledger_cursors as c (user_id, seq)
  values (new.user_id, 1)
  on conflict (user_id) do update set seq = c.seq + 1
  returning c.seq into new.server_seq;
  return new;
end;
$$;

drop trigger if exists ledger_entities_stamp on public.ledger_entities;
create trigger ledger_entities_stamp
  before insert or update on public.ledger_entities
  for each row execute function public.ledger_entities_stamp();

-- The only write path. `rows` is a JSON array of
--   { kind, id, data, deleted, updated_at }.
-- A row is applied only if it is newer than what the server holds, which makes
-- retries idempotent and gives last-writer-wins. Returns how many rows applied.
create or replace function public.push_ledger_entities(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  applied integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 2000 then
    raise exception 'too many rows in one push (max 2000)' using errcode = '54000';
  end if;

  with incoming as (
    select
      r->>'kind'                                   as kind,
      r->>'id'                                     as id,
      nullif(r->'data', 'null'::jsonb)             as data,
      coalesce((r->>'deleted')::boolean, false)    as deleted,
      -- a device with a wrong clock must not be able to win every conflict
      least((r->>'updated_at')::timestamptz, now() + interval '5 minutes') as updated_at
    from jsonb_array_elements(rows) as r
  ),
  latest as (
    select distinct on (kind, id) *
    from incoming
    order by kind, id, updated_at desc
  )
  insert into public.ledger_entities as e (user_id, kind, id, data, deleted, updated_at)
  select uid, kind, id, case when deleted then null else data end, deleted, updated_at
  from latest
  on conflict (user_id, kind, id) do update
    set data       = excluded.data,
        deleted    = excluded.deleted,
        updated_at = excluded.updated_at
    where excluded.updated_at > e.updated_at;

  get diagnostics applied = row_count;
  return applied;
end;
$$;

revoke all on function public.push_ledger_entities(jsonb) from public, anon;
grant execute on function public.push_ledger_entities(jsonb) to authenticated;

-- Realtime: lets other devices hear "something changed" and pull.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.ledger_entities;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
