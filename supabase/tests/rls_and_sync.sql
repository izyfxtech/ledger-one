-- Run against any Postgres with the migration applied. On a local scratch DB,
-- first load tests/supabase_stub.sql so `auth.users`, `auth.uid()` and the
-- `authenticated`/`anon` roles exist (Supabase provides them for real).
\set ON_ERROR_STOP on
\set a '00000000-0000-0000-0000-00000000000a'
\set b '00000000-0000-0000-0000-00000000000b'

insert into auth.users(id) values (:'a'), (:'b') on conflict do nothing;
truncate public.ledger_entities, public.ledger_cursors;

-- helpers (scratch schema; test DB only)
create schema if not exists tst;
grant usage on schema tst to anon, authenticated;
create or replace function tst.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create or replace function tst.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;
grant execute on all functions in schema tst to anon, authenticated;

-- ---- 1. push as A: insert two rows -------------------------------------
select tst.as_user(:'a');
select public.push_ledger_entities('[
  {"kind":"transaction","id":"t1","data":{"id":"t1","description":"v1"},"deleted":false,"updated_at":"2026-01-01T00:00:00Z"},
  {"kind":"object","id":"o1","data":{"id":"o1","name":"Cash"},"deleted":false,"updated_at":"2026-01-01T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 2, 'first push should apply 2 rows');

-- ---- 2. last-writer-wins -------------------------------------------------
select public.push_ledger_entities('[
  {"kind":"transaction","id":"t1","data":{"id":"t1","description":"OLD"},"deleted":false,"updated_at":"2025-12-31T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 0, 'older write must be rejected');
select public.push_ledger_entities('[
  {"kind":"transaction","id":"t1","data":{"id":"t1","description":"v2"},"deleted":false,"updated_at":"2026-01-02T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 1, 'newer write must apply');
do $$ begin
  assert (select data->>'description' from public.ledger_entities where id='t1') = 'v2';
end $$;

-- retry of the same row is idempotent (equal timestamp is not "newer")
select public.push_ledger_entities('[
  {"kind":"transaction","id":"t1","data":{"id":"t1","description":"v2"},"deleted":false,"updated_at":"2026-01-02T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 0, 'retry must be a no-op');

-- ---- 3. tombstones -------------------------------------------------------
select public.push_ledger_entities('[
  {"kind":"object","id":"o1","data":null,"deleted":true,"updated_at":"2026-01-03T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 1, 'tombstone push applies');
select tst.ok((select deleted from public.ledger_entities where id='o1'), 'row is marked deleted');
select tst.ok((select data from public.ledger_entities where id='o1') is null, 'tombstone has no payload');
-- a stale edit cannot resurrect a deleted row
select public.push_ledger_entities('[
  {"kind":"object","id":"o1","data":{"id":"o1","name":"Back"},"deleted":false,"updated_at":"2026-01-02T12:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 0, 'stale edit must not undelete');

-- ---- 4. per-user sequence is strictly increasing and pull-able -----------
do $$ begin
  assert (select count(*) from public.ledger_entities where server_seq > 0) = 2;
  assert (select count(distinct server_seq) from public.ledger_entities) = 2, 'seqs must be unique per user';
  -- t1 was written after o1's first write, then o1 was tombstoned last
  assert (select server_seq from public.ledger_entities where id='o1')
       > (select server_seq from public.ledger_entities where id='t1');
end $$;

-- ---- 5. clock clamp ------------------------------------------------------
select public.push_ledger_entities('[
  {"kind":"fx","id":"NGN","data":{"base":"NGN","quote":"USD","rate":0.001},"deleted":false,"updated_at":"2999-01-01T00:00:00Z"}
]'::jsonb);
do $$ begin
  assert (select updated_at from public.ledger_entities where id='NGN') < now() + interval '10 minutes',
    'far-future timestamps must be clamped';
end $$;

-- ---- 6. isolation: B sees nothing of A's, and cannot write A's rows ------
select tst.as_user(:'b');
do $$ begin assert (select count(*) from public.ledger_entities) = 0, 'B must not read A rows'; end $$;
select public.push_ledger_entities('[
  {"kind":"transaction","id":"t1","data":{"id":"t1","description":"B-owned"},"deleted":false,"updated_at":"2030-01-01T00:00:00Z"}
]'::jsonb) as applied \gset
select tst.ok(:applied = 1, 'B gets their own t1 row');
reset role;
do $$ begin
  assert (select description from (select data->>'description' as description from public.ledger_entities where user_id='00000000-0000-0000-0000-00000000000a' and id='t1') s) = 'v2',
    'A row untouched by B';
  assert (select count(*) from public.ledger_entities where id='t1') = 2, 'same id may exist for both users';
end $$;

-- ---- 7. direct writes are refused, anon is refused -----------------------
select tst.as_user(:'b');
do $$ begin
  begin
    insert into public.ledger_entities(user_id, kind, id, data, updated_at)
      values ('00000000-0000-0000-0000-00000000000b','goal','g','{}'::jsonb, now());
    raise exception 'direct insert should have been denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ledger_entities set data = '{}'::jsonb;
    raise exception 'direct update should have been denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ledger_entities;
    raise exception 'direct delete should have been denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.push_ledger_entities('[]'::jsonb);
    raise exception 'anon push should have been denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.ledger_entities;
    raise exception 'anon read should have been denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- 8. bad input --------------------------------------------------------
select tst.as_user(:'a');
do $$ begin
  begin
    perform public.push_ledger_entities('[{"kind":"nonsense","id":"x","data":{},"deleted":false,"updated_at":"2026-01-01T00:00:00Z"}]'::jsonb);
    raise exception 'unknown kind should be rejected';
  exception when check_violation then null;
  end;
  begin
    perform public.push_ledger_entities('{"not":"an array"}'::jsonb);
    raise exception 'non-array should be rejected';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

\echo ALL RLS/SYNC CHECKS PASSED
