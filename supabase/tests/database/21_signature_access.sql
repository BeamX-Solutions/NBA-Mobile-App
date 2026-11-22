-- Who can read a branch's chairman signature (20261123100000).
--
-- Its own members and administrators, the super administrator, and a
-- practitioner holding a verified transaction from that branch even after
-- moving; nobody else. Writes are unchanged and covered elsewhere.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

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
-- Fixtures
--
-- Branch S has a signature. Its member and its administrator read it.
-- Branch T: one member with no tie to S, and one who moved there from S and
-- holds a verified transaction drawn on S.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1e000000-0000-0000-0000-0000000000aa', 'Sig Test S Branch', 'SGS', 'Anambra', 'S8', 'S Account', 'active', now()),
  ('1e000000-0000-0000-0000-0000000000bb', 'Sig Test T Branch', 'SGT', 'Anambra', 'T8', 'T Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2e000000-0000-0000-0000-0000000000a1', 'sig.s.member@example.com',
   '{"full_name": "Sig S Member", "scn": "SGT0001", "branch_code": "SGS"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000a2', 'sig.s.admin@example.com',
   '{"full_name": "Sig S Admin", "scn": "SGT0002", "branch_code": "SGS"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000b1', 'sig.t.member@example.com',
   '{"full_name": "Sig T Member", "scn": "SGT0003", "branch_code": "SGT"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000b2', 'sig.mover@example.com',
   '{"full_name": "Sig Mover", "scn": "SGT0004", "branch_code": "SGT"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000b3', 'sig.unverified@example.com',
   '{"full_name": "Sig Unverified", "scn": "SGT0006", "branch_code": "SGT"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000c1', 'sig.super@example.com',
   '{"full_name": "Sig Super", "scn": "SGT0005", "branch_code": "SGS"}'::jsonb);

update public.profiles set membership_status = 'approved' where id::text like '2e000000-%';
update public.profiles set role = 'branch_admin' where id = '2e000000-0000-0000-0000-0000000000a2';
update public.profiles set role = 'super_admin', branch_id = null where id = '2e000000-0000-0000-0000-0000000000c1';

-- The mover's certificate was drawn on S before they moved to T.
insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee, status, verified_at) values
  ('3e000000-0000-0000-0000-0000000000b2', '2e000000-0000-0000-0000-0000000000b2',
   '1e000000-0000-0000-0000-0000000000aa', 'A to B', 'deed_of_assignment', 1000000, 100000, 2000, 'verified', now()),
  ('3e000000-0000-0000-0000-0000000000b3', '2e000000-0000-0000-0000-0000000000b3',
   '1e000000-0000-0000-0000-0000000000aa', 'C to D', 'deed_of_assignment', 1000000, 100000, 2000, 'pending_verification', null);

insert into storage.objects (bucket_id, name) values
  ('signatures', '1e000000-0000-0000-0000-0000000000aa/signature.png');

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

create function pg_temp.sees_signature() returns int language sql as $$
  select count(*)::int from storage.objects
  where bucket_id = 'signatures' and name = '1e000000-0000-0000-0000-0000000000aa/signature.png'
$$;

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sees_signature(), 1, 'a member of the branch reads its signature');

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a2');
select is(pg_temp.sees_signature(), 1, 'the branch''s administrator reads it');

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000c1');
select is(pg_temp.sees_signature(), 1, 'the super administrator reads it');

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000b2');
select is(pg_temp.sees_signature(), 1,
  'a practitioner who moved away still reads it for a certificate drawn on that branch');

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000b1');
select is(pg_temp.sees_signature(), 0, 'a member of another branch cannot read it');

select pg_temp.impersonate(null, 'anon');
select is(pg_temp.sees_signature(), 0, 'nobody signed out can read it');

-- A transaction from that branch that was never verified gives no access.
select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000b3');
select is(pg_temp.sees_signature(), 0, 'an unverified transaction from that branch gives no access');

select * from finish();
rollback;
