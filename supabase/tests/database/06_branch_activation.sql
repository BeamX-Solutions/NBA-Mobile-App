-- Branch activation.
--
-- activation_status was decorative until 20260922100000: displayed, guarded,
-- and read by nothing. These assertions are what make it load bearing, and the
-- one that matters most is that an inactive branch cannot draw an invoice,
-- because that is the only consequence the column has.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

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

create function pg_temp.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: three branches, one left active, two deactivated
-- ---------------------------------------------------------------------------

-- All three start active, and two are knocked back afterwards.
--
-- The order matters and is not incidental. handle_new_user refuses a signup
-- against a branch that has not joined, so members of the two deactivated
-- branches cannot be created while those branches are in that state. It is
-- also the truthful sequence: these are people who joined while their branch
-- was on the platform and are still members after it was switched off, which
-- is what the invoice assertions below are about.
insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('14000000-0000-0000-0000-0000000000aa', 'Act Branch', 'ACTA', 'Anambra', 'AA', 'A Account',
   'active', now()),
  ('14000000-0000-0000-0000-0000000000bb', 'Inact Branch', 'ACTB', 'Lagos', 'AB', 'B Account',
   'active', now()),
  ('14000000-0000-0000-0000-0000000000cc', 'Lapsed Branch', 'ACTC', 'Abia', 'AC', 'C Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('24000000-0000-0000-0000-0000000000a1', 'act.member.a@example.com',
   '{"full_name": "Act Member A", "scn": "ACT0001", "branch_code": "ACTA"}'::jsonb),
  ('24000000-0000-0000-0000-0000000000b1', 'act.member.b@example.com',
   '{"full_name": "Act Member B", "scn": "ACT0002", "branch_code": "ACTB"}'::jsonb),
  ('24000000-0000-0000-0000-0000000000c1', 'act.member.c@example.com',
   '{"full_name": "Act Member C", "scn": "ACT0003", "branch_code": "ACTC"}'::jsonb),
  ('24000000-0000-0000-0000-0000000000d1', 'act.super@example.com',
   '{"full_name": "Act Super", "scn": "ACT0004", "branch_code": "ACTA"}'::jsonb);

update public.profiles set role = 'super_admin'
where id = '24000000-0000-0000-0000-0000000000d1';

-- Now put two of them where the assertions need them, directly rather than
-- through set_branch_activation: this is fixture setup, not the behaviour
-- under test.
update public.branches
set activation_status = 'inactive', activated_at = null
where id = '14000000-0000-0000-0000-0000000000bb';

-- A second deactivated branch. This one used to carry an expiry in the past,
-- back when a branch could lapse on a date; branches do not expire any more,
-- so the only way off the platform is being switched off.
update public.branches
set activation_status = 'inactive'
where id = '14000000-0000-0000-0000-0000000000cc';

-- Every practitioner subscribed, so the only thing that can refuse an invoice
-- below is the branch. Without this a failure could mean either gate.
insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
select id, 'yearly', 'standard', 1400000, now(), now() + interval '1 year', 'active'
from unnest(array[
  '24000000-0000-0000-0000-0000000000a1'::uuid,
  '24000000-0000-0000-0000-0000000000b1'::uuid,
  '24000000-0000-0000-0000-0000000000c1'::uuid
]) as id;

-- ---------------------------------------------------------------------------
-- branch_is_active
-- ---------------------------------------------------------------------------

select is(
  public.branch_is_active('14000000-0000-0000-0000-0000000000aa'),
  true,
  'an active branch is active'
);

select is(
  public.branch_is_active('14000000-0000-0000-0000-0000000000bb'),
  false,
  'an inactive branch is not active'
);

select is(
  public.branch_is_active('14000000-0000-0000-0000-0000000000cc'),
  false,
  'a second deactivated branch is not active either'
);

select is(
  public.branch_is_active('00000000-0000-0000-0000-0000000000ff'),
  false,
  'a branch that does not exist is not active'
);

-- ---------------------------------------------------------------------------
-- The consequence: drawing an invoice
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('24000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $probe$ select public.create_transaction(
    'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
    'Act Party A to Act Party B') $probe$,
  'a practitioner in an active branch draws an invoice'
);

select pg_temp.impersonate('24000000-0000-0000-0000-0000000000b1');

select throws_ok(
  $probe$ select public.create_transaction(
    'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
    'Act Party C to Act Party D') $probe$,
  'P0001',
  null,
  'a practitioner in an inactive branch cannot draw an invoice'
);

select pg_temp.impersonate('24000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $probe$ select public.create_transaction(
    'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
    'Act Party E to Act Party F') $probe$,
  'P0001',
  null,
  'a practitioner in a branch switched off after they joined cannot draw an invoice'
);

-- ---------------------------------------------------------------------------
-- Who may change activation
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('24000000-0000-0000-0000-0000000000a1');

select throws_ok(
  format('select public.set_branch_activation(%L, %L)',
         '14000000-0000-0000-0000-0000000000bb', 'active'),
  '42501',
  null,
  'a practitioner cannot activate a branch'
);

-- ---------------------------------------------------------------------------
-- The super administrator
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('24000000-0000-0000-0000-0000000000d1');

select lives_ok(
  format('select public.set_branch_activation(%L, %L)',
         '14000000-0000-0000-0000-0000000000bb', 'active'),
  'a super administrator activates a branch'
);

-- Activation records when the branch joined, and nothing else. There is no
-- term, so there is nothing that could quietly run out.
select isnt(
  (select activated_at from public.branches
   where id = '14000000-0000-0000-0000-0000000000bb'),
  null,
  'activating stamps when the branch joined'
);

select is(
  public.branch_is_active('14000000-0000-0000-0000-0000000000bb'),
  true,
  'the newly activated branch is active'
);

-- ---------------------------------------------------------------------------
-- What activation is actually for: appearing at signup
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.list_branches_for_signup()
   where branch_code = 'ACTA'),
  1,
  'an active branch is offered at signup'
);

select is(
  (select count(*)::int from public.list_branches_for_signup()
   where branch_code = 'ACTC'),
  0,
  'a deactivated branch is not offered at signup'
);

-- ACTB was activated a few assertions above, so this also shows that
-- activating a branch is what puts it on the list.
select is(
  (select count(*)::int from public.list_branches_for_signup()
   where branch_code = 'ACTB'),
  1,
  'a branch becomes selectable at signup once activated'
);

-- The picker filters, but branch_code arrives in client supplied metadata, so
-- the trigger has to refuse it too. Registering against the lapsed branch is
-- the case a crafted payload would attempt.
--
-- Back to the service role first. Signup writes auth.users as Supabase's own
-- auth service, and an authenticated role cannot write that table at all, so
-- left impersonating this would fail on privileges before ever reaching the
-- trigger and would pass for the wrong reason.
select pg_temp.as_service();

select throws_ok(
  $probe$ insert into auth.users (id, email, raw_user_meta_data)
     values ('24000000-0000-0000-0000-0000000000e1', 'act.reject@example.com',
             '{"full_name": "Act Reject", "scn": "ACT0005", "branch_code": "ACTC"}'::jsonb) $probe$,
  'P0001',
  null,
  'signing up against a branch that has not joined is refused'
);

select * from finish();

rollback;
