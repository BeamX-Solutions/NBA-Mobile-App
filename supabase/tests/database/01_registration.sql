-- Registration flow: profile creation from auth signup metadata,
-- with and without a branch code. Run with `supabase test db`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Fixtures. The state row may already exist via seed.sql; that is fine.
insert into public.state_bands (state, band) values ('Lagos', 3)
on conflict (state) do nothing;

insert into public.branches (id, name, branch_code)
values ('10000000-0000-0000-0000-000000000001', 'Test Branch', 'TESTBR');

select is(public.validate_branch_code('testbr'), true, 'validate_branch_code accepts a known code case-insensitively');
select is(public.validate_branch_code('NOPE'), false, 'validate_branch_code rejects an unknown code');

-- Signup with a valid branch code becomes a branch member.
insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000a',
  'member@example.com',
  '{"full_name": "Ada Member", "phone": "0800000001", "scn": "SCN0001", "branch_code": "testbr", "practice_state": "Lagos"}'::jsonb
);

select results_eq(
  $$ select role::text, branch_id, practice_state from public.profiles
     where id = '20000000-0000-0000-0000-00000000000a' $$,
  $$ values ('branch_member'::text, '10000000-0000-0000-0000-000000000001'::uuid, 'Lagos'::text) $$,
  'valid branch code yields branch_member attached to the branch'
);

select is(
  (select scn from public.profiles where id = '20000000-0000-0000-0000-00000000000a'),
  'SCN0001',
  'SCN is stored from signup metadata'
);

-- Signup without a branch code becomes an individual.
insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000b',
  'solo@example.com',
  '{"full_name": "Solo Individual", "scn": "SCN0002"}'::jsonb
);

select results_eq(
  $$ select role::text, branch_id from public.profiles
     where id = '20000000-0000-0000-0000-00000000000b' $$,
  $$ values ('individual'::text, null::uuid) $$,
  'no branch code yields an individual with no branch'
);

-- Signup with an unknown branch code fails loudly instead of silently
-- downgrading the user to standard rates.
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('20000000-0000-0000-0000-00000000000c', 'bad@example.com',
             '{"branch_code": "WRONG"}'::jsonb) $$,
  'P0001',
  'Unknown branch code WRONG',
  'unknown branch code aborts signup'
);

-- Unrecognised practice state is dropped, not fatal.
insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000d',
  'state@example.com',
  '{"full_name": "Bad State", "practice_state": "Atlantis"}'::jsonb
);

select is(
  (select practice_state from public.profiles where id = '20000000-0000-0000-0000-00000000000d'),
  null,
  'unknown practice state is stored as null'
);

-- Duplicate SCN cannot register twice.
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('20000000-0000-0000-0000-00000000000e', 'dupe@example.com',
             '{"scn": "SCN0001"}'::jsonb) $$,
  '23505',
  null,
  'duplicate SCN aborts signup'
);

-- Roles from metadata are ignored: nobody signs up as an admin.
insert into auth.users (id, email, raw_user_meta_data)
values (
  '20000000-0000-0000-0000-00000000000f',
  'sneaky@example.com',
  '{"full_name": "Sneaky", "role": "super_admin"}'::jsonb
);

select is(
  (select role::text from public.profiles where id = '20000000-0000-0000-0000-00000000000f'),
  'individual',
  'role in signup metadata is ignored'
);

select * from finish();

rollback;
