-- A branch approves each member who signs up to it.
--
-- A signup is pending until an administrator of its branch approves it, and a
-- pending member can do nothing that matters. A rejected member sees why, may
-- correct their SCN or branch, and resubmit. These assertions cover the path
-- through that, and that nobody reaches the end of it by writing the columns
-- themselves.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

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
-- Fixtures: two branches, a new member and an administrator of the first, an
-- administrator of the second, a second new member, and a super administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('16000000-0000-0000-0000-0000000000aa', 'Member Branch A', 'MBA', 'Anambra', 'BA', 'BA Account',
   'active', now()),
  ('16000000-0000-0000-0000-0000000000bb', 'Member Branch B', 'MBB', 'Lagos', 'BB', 'BB Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('28000000-0000-0000-0000-0000000000a1', 'mem.new.a@example.com',
   '{"full_name": "Mem New A", "scn": "MEM0001", "branch_code": "MBA"}'::jsonb),
  ('28000000-0000-0000-0000-0000000000a2', 'mem.admin.a@example.com',
   '{"full_name": "Mem Admin A", "scn": "MEM0002", "branch_code": "MBA"}'::jsonb),
  ('28000000-0000-0000-0000-0000000000a3', 'mem.new.a2@example.com',
   '{"full_name": "Mem New A Two", "scn": "MEM0003", "branch_code": "MBA"}'::jsonb),
  ('28000000-0000-0000-0000-0000000000b2', 'mem.admin.b@example.com',
   '{"full_name": "Mem Admin B", "scn": "MEM0004", "branch_code": "MBB"}'::jsonb),
  ('28000000-0000-0000-0000-0000000000c1', 'mem.super@example.com',
   '{"full_name": "Mem Super", "scn": "MEM0005", "branch_code": "MBA"}'::jsonb);

-- Administrators are appointed from the signups here, so their own status is
-- left pending on purpose: they are exempt, and one assertion checks that.
update public.profiles set role = 'branch_admin'
where id in ('28000000-0000-0000-0000-0000000000a2',
             '28000000-0000-0000-0000-0000000000b2');

update public.profiles set role = 'super_admin'
where id = '28000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------------------
-- A signup waits
-- ---------------------------------------------------------------------------

select is(
  (select membership_status from public.profiles
   where id = '28000000-0000-0000-0000-0000000000a1'),
  'pending',
  'a new signup is pending'
);

select is(
  public.membership_approved('28000000-0000-0000-0000-0000000000a1'),
  false,
  'and is not an approved member'
);

select is(
  public.membership_approved('28000000-0000-0000-0000-0000000000a2'),
  true,
  'an administrator is exempt'
);

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
       'Pending A to Pending B') $$,
  'P0001',
  'Your branch has not approved your membership yet, so you cannot generate an invoice.',
  'a pending member cannot draw an invoice'
);

select throws_ok(
  $$ update public.profiles set membership_status = 'approved'
     where id = '28000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  'membership is decided by your branch',
  'a member cannot approve themselves'
);

select throws_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', true) $$,
  '42501',
  null,
  'nor through the review function'
);

-- ---------------------------------------------------------------------------
-- The branch decides
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000b2');

select throws_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', true) $$,
  '42501',
  null,
  'another branch cannot decide it'
);

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', false, '  ') $$,
  '23514',
  null,
  'a rejection needs a reason'
);

select lives_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', false,
       'SCN does not match the roll') $$,
  'the branch rejects with a reason'
);

select is(
  (select membership_rejection_reason from public.profiles
   where id = '28000000-0000-0000-0000-0000000000a1'),
  'SCN does not match the roll',
  'and the reason is kept for the member to read'
);

-- ---------------------------------------------------------------------------
-- The member corrects and resubmits
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ update public.profiles set scn = 'MEM0001A'
     where id = '28000000-0000-0000-0000-0000000000a1' $$,
  'a member not yet approved can correct their SCN'
);

select lives_ok(
  $$ select public.resubmit_membership() $$,
  'and resubmit'
);

select is(
  (select membership_status || '/' || coalesce(membership_rejection_reason, 'none')
   from public.profiles where id = '28000000-0000-0000-0000-0000000000a1'),
  'pending/none',
  'which puts them back in the queue with the old reason cleared'
);

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', true) $$,
  'the branch approves'
);

select is(
  public.membership_approved('28000000-0000-0000-0000-0000000000a1'),
  true,
  'and the member is approved'
);

select throws_ok(
  $$ select public.review_membership('28000000-0000-0000-0000-0000000000a1', false, 'Changed my mind') $$,
  'P0001',
  'This request has already been decided',
  'a decision is made once'
);

-- ---------------------------------------------------------------------------
-- After approval
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ update public.profiles set scn = 'MEM9999'
     where id = '28000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'an approved member can no longer change their own SCN'
);

select throws_ok(
  $$ select public.resubmit_membership() $$,
  'P0001',
  'Only a rejected request can be resubmitted',
  'and there is nothing to resubmit'
);

select pg_temp.impersonate('28000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select * from public.set_user_role('28000000-0000-0000-0000-0000000000a3', 'branch_admin') $$,
  '22023',
  'Their branch has not approved their membership yet',
  'a pending member cannot be made an administrator'
);

-- A second member in the same branch, to show a decision reaches only the
-- person it was made about.
select is(
  (select membership_status from public.profiles
   where id = '28000000-0000-0000-0000-0000000000a3'),
  'pending',
  'another pending member is untouched by the decisions above'
);

select * from finish();

rollback;
