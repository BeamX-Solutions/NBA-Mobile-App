-- Registration: what handle_new_user does with signup metadata.
--
-- Run with `npm test` from supabase/tests, or `supabase test db` where the
-- local Docker stack is available.
--
-- This suite was written against an earlier model and had rotted badly: it
-- referenced public.state_bands, which was dropped when the State Band concept
-- was removed, and asserted that a signup without a branch code produced an
-- 'individual'. Branch affiliation became compulsory on 16 August 2026, so
-- that signup now aborts. The assertions below describe current behaviour.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Fixtures. A branch must declare its state: practice_state is derived from
-- the branch rather than chosen, so a branch without one could not produce a
-- valid profile.
insert into public.branches (id, name, branch_code, state, short_code)
values ('10000000-0000-0000-0000-000000000001', 'Test Branch', 'TESTBR', 'Lagos', 'TB');

-- ---------------------------------------------------------------------------
-- Branch code validation, which the registration screen calls anonymously
-- ---------------------------------------------------------------------------

select is(
  public.validate_branch_code('testbr'), true,
  'validate_branch_code accepts a known code case-insensitively'
);
select is(
  public.validate_branch_code('NOPE'), false,
  'validate_branch_code rejects an unknown code'
);

-- ---------------------------------------------------------------------------
-- A valid branch code
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000a',
  'member@example.com',
  '{"full_name": "Ada Member", "phone": "0800000001", "scn": "SCN0001", "branch_code": "testbr"}'::jsonb
);

select results_eq(
  $$ select role::text, branch_id from public.profiles
     where id = '20000000-0000-0000-0000-00000000000a' $$,
  $$ values ('branch_member'::text, '10000000-0000-0000-0000-000000000001'::uuid) $$,
  'a valid branch code yields a branch_member attached to that branch'
);

select is(
  (select scn from public.profiles where id = '20000000-0000-0000-0000-00000000000a'),
  'SCN0001',
  'SCN is stored from signup metadata'
);

-- practice_state comes from the branch, never from the client. A crafted
-- payload must not be able to record a state that contradicts the branch.
select is(
  (select practice_state from public.profiles where id = '20000000-0000-0000-0000-00000000000a'),
  'Lagos',
  'practice_state is derived from the branch'
);

-- ---------------------------------------------------------------------------
-- A missing or unknown branch code aborts
-- ---------------------------------------------------------------------------

-- Registration without a branch is no longer possible. A lawyer whose branch
-- has not joined cannot register at all, which is the accepted cost of making
-- branch affiliation compulsory.
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('20000000-0000-0000-0000-00000000000b', 'solo@example.com',
             '{"full_name": "Solo", "scn": "SCN0002"}'::jsonb) $$,
  'P0001',
  'A branch code is required to register',
  'signup without a branch code aborts'
);

-- An unknown code fails loudly rather than silently registering the user with
-- no branch, which would leave them unable to be paid or verified.
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('20000000-0000-0000-0000-00000000000c', 'bad@example.com',
             '{"branch_code": "WRONG"}'::jsonb) $$,
  'P0001',
  'Unknown branch code WRONG',
  'an unknown branch code aborts signup'
);

-- ---------------------------------------------------------------------------
-- Metadata a client must not be able to dictate
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000d',
  'state@example.com',
  '{"full_name": "Wrong State", "branch_code": "TESTBR", "practice_state": "Atlantis"}'::jsonb
);

select is(
  (select practice_state from public.profiles where id = '20000000-0000-0000-0000-00000000000d'),
  'Lagos',
  'practice_state in metadata is ignored in favour of the branch'
);

-- Nobody signs themselves up as an administrator.
insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000f',
  'sneaky@example.com',
  '{"full_name": "Sneaky", "branch_code": "TESTBR", "role": "super_admin"}'::jsonb
);

select is(
  (select role::text from public.profiles where id = '20000000-0000-0000-0000-00000000000f'),
  'branch_member',
  'a role in signup metadata is ignored'
);

-- ---------------------------------------------------------------------------
-- Uniqueness
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('20000000-0000-0000-0000-00000000000e', 'dupe@example.com',
             '{"branch_code": "TESTBR", "scn": "SCN0001"}'::jsonb) $$,
  '23505',
  null,
  'a duplicate SCN aborts signup'
);

select * from finish();

rollback;
