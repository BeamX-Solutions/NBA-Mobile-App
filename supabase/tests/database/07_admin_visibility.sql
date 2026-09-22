-- What an administrator may see.
--
-- Adding a read policy widens who can see a row, which is the direction that
-- goes wrong quietly: a policy scoped one join too loosely shows every branch's
-- billing to every branch administrator, and nothing fails when it does. The
-- assertions here are mostly about who still cannot see what.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.impersonate(uid uuid, jwt_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', jwt_role)::text,
    true
  );
  perform set_config('role', jwt_role, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: two branches, a practitioner and an administrator in each
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('15000000-0000-0000-0000-0000000000aa', 'Vis Branch A', 'VISA', 'Anambra', 'VA', 'VA Account',
   'active', now()),
  ('15000000-0000-0000-0000-0000000000bb', 'Vis Branch B', 'VISB', 'Lagos', 'VB', 'VB Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('25000000-0000-0000-0000-0000000000a1', 'vis.member.a@example.com',
   '{"full_name": "Vis Member A", "scn": "VIS0001", "branch_code": "VISA"}'::jsonb),
  ('25000000-0000-0000-0000-0000000000a2', 'vis.admin.a@example.com',
   '{"full_name": "Vis Admin A", "scn": "VIS0002", "branch_code": "VISA"}'::jsonb),
  ('25000000-0000-0000-0000-0000000000b1', 'vis.member.b@example.com',
   '{"full_name": "Vis Member B", "scn": "VIS0003", "branch_code": "VISB"}'::jsonb),
  ('25000000-0000-0000-0000-0000000000b2', 'vis.admin.b@example.com',
   '{"full_name": "Vis Admin B", "scn": "VIS0004", "branch_code": "VISB"}'::jsonb),
  ('25000000-0000-0000-0000-0000000000c1', 'vis.super@example.com',
   '{"full_name": "Vis Super", "scn": "VIS0005", "branch_code": "VISA"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('25000000-0000-0000-0000-0000000000a2',
             '25000000-0000-0000-0000-0000000000b2');

update public.profiles set role = 'super_admin'
where id = '25000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status) values
  ('25000000-0000-0000-0000-0000000000a1', 'yearly', 'standard', 1400000,
   now(), now() + interval '1 year', 'active'),
  ('25000000-0000-0000-0000-0000000000b1', 'monthly', 'standard', 200000,
   now(), now() + interval '1 month', 'active');

-- ---------------------------------------------------------------------------
-- Subscriptions: the branch administrator sees their own members, and no more
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('25000000-0000-0000-0000-0000000000a2');

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '25000000-0000-0000-0000-0000000000a1'),
  1,
  'a branch administrator reads a subscription of their own member'
);

-- The join through profiles is the whole of the scoping. If it were dropped or
-- written against the wrong column, this is the assertion that would catch it.
select is(
  (select count(*)::int from public.subscriptions
   where user_id = '25000000-0000-0000-0000-0000000000b1'),
  0,
  'a branch administrator cannot read another branch subscription'
);

select pg_temp.impersonate('25000000-0000-0000-0000-0000000000b2');

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '25000000-0000-0000-0000-0000000000a1'),
  0,
  'the other branch administrator is refused in the same way'
);

-- A practitioner gains nothing from this policy. current_user_role is
-- branch_member for them, so the new clause never matches and only the
-- pre-existing owner policy applies.
select pg_temp.impersonate('25000000-0000-0000-0000-0000000000a1');

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '25000000-0000-0000-0000-0000000000b1'),
  0,
  'a practitioner still cannot read another practitioner subscription'
);

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '25000000-0000-0000-0000-0000000000a1'),
  1,
  'a practitioner still reads their own subscription'
);

select pg_temp.impersonate('25000000-0000-0000-0000-0000000000c1');

-- Counted over the fixture users rather than the whole table. These suites run
-- against the hosted project, which carries real rows, so an unscoped count
-- asserts the state of production and fails whenever somebody subscribes.
select is(
  (select count(*)::int from public.subscriptions
   where user_id in ('25000000-0000-0000-0000-0000000000a1',
                     '25000000-0000-0000-0000-0000000000b1')),
  2,
  'the super administrator reads subscriptions across both branches'
);

-- ---------------------------------------------------------------------------
-- The audit log, which the console now surfaces
-- ---------------------------------------------------------------------------
--
-- The viewer added alongside this migration reads audit_log directly, so it is
-- worth pinning that the existing policy really does admit the super
-- administrator alone. Nothing here changes it; this asserts it still holds.

select is(
  (select count(*)::int from public.audit_log) > 0,
  true,
  'the super administrator reads the audit log'
);

select pg_temp.impersonate('25000000-0000-0000-0000-0000000000a2');

select is(
  (select count(*)::int from public.audit_log),
  0,
  'a branch administrator sees no audit log at all'
);

select * from finish();

rollback;
