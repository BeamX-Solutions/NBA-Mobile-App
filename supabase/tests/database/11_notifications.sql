-- Practitioners are told when something happens to their account or work.
--
-- The notifications come from triggers, so these assertions drive the same
-- functions and updates the admin console uses and check that each event
-- leaves exactly one notification for its owner and none for anyone else.
-- They also check that nobody can write a notification from a client, and
-- that the owner can only mark their own read.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

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

-- Reads every notification regardless of RLS, for counting.
create function pg_temp.as_owner()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Sorted by kind: within one test transaction every row shares now().
create function pg_temp.kinds(uid uuid)
returns text[]
language sql
as $$
  select coalesce(array_agg(kind order by kind), '{}')
  from public.notifications where user_id = uid;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: a branch, two new members, its administrator, and a super administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('17000000-0000-0000-0000-0000000000aa', 'Notify Branch A', 'NTA', 'Anambra', 'NA', 'NA Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('29000000-0000-0000-0000-0000000000a1', 'notify.member.a@example.com',
   '{"full_name": "Notify Member A", "scn": "NTF0001", "branch_code": "NTA"}'::jsonb),
  ('29000000-0000-0000-0000-0000000000a2', 'notify.admin.a@example.com',
   '{"full_name": "Notify Admin A", "scn": "NTF0002", "branch_code": "NTA"}'::jsonb),
  ('29000000-0000-0000-0000-0000000000a3', 'notify.member.other@example.com',
   '{"full_name": "Notify Member Other", "scn": "NTF0003", "branch_code": "NTA"}'::jsonb),
  ('29000000-0000-0000-0000-0000000000c1', 'notify.super@example.com',
   '{"full_name": "Notify Super", "scn": "NTF0004", "branch_code": "NTA"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id = '29000000-0000-0000-0000-0000000000a2';

update public.profiles set role = 'super_admin'
where id = '29000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('29000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

select pg_temp.as_owner();

select is(
  (select count(*)::int from public.notifications where user_id::text like '29000000-%'),
  0,
  'signing up notifies nobody'
);

-- ---------------------------------------------------------------------------
-- Membership decided
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a2');
select public.review_membership('29000000-0000-0000-0000-0000000000a1', true);
select public.review_membership('29000000-0000-0000-0000-0000000000a3', false, 'SCN not on the roll');

select pg_temp.as_owner();

select is(
  pg_temp.kinds('29000000-0000-0000-0000-0000000000a1'),
  array['membership_approved'],
  'an approved member is told once'
);

select is(
  (select link from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'membership_approved'),
  '/profile/edit',
  'and, with no bank details yet, is sent to add them'
);

select matches(
  (select body from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'membership_approved'),
  'Add your bank details',
  'and is told why'
);

select is(
  pg_temp.kinds('29000000-0000-0000-0000-0000000000a3'),
  array['membership_rejected'],
  'a rejected member is told once'
);

select matches(
  (select body from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a3'),
  'SCN not on the roll',
  'with the reason'
);

select is(
  (select count(*)::int from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a2'),
  0,
  'the administrator who decided is not notified'
);

-- ---------------------------------------------------------------------------
-- A proof of payment rejected, then verified
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a1');

update public.profiles
set bank_account_name = 'Notify Member A', bank_account_number = '0123456789',
    bank_name = 'Test Bank'
where id = '29000000-0000-0000-0000-0000000000a1';

create temporary table nt_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Notify Party A to Notify Party B');

update public.transactions
set proof_url = '29000000-0000-0000-0000-0000000000a1/slip.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.nt_txn);

select pg_temp.as_owner();

select is(
  pg_temp.kinds('29000000-0000-0000-0000-0000000000a1'),
  array['membership_approved'],
  'drawing an invoice and submitting a proof notify nobody'
);

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a2');

-- As the admin console rejects: a direct update, checked by the trigger.
update public.transactions
set status = 'rejected', rejection_reason = 'Amount does not match'
where id = (select transaction_id from pg_temp.nt_txn);

select pg_temp.as_owner();

select is(
  (select count(*)::int from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'payment_rejected'),
  1,
  'a rejected proof is reported once'
);

select matches(
  (select body from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'payment_rejected'),
  'Amount does not match',
  'with the reason'
);

select is(
  (select link from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'payment_rejected'),
  '/transactions/' || (select transaction_id from pg_temp.nt_txn),
  'and links to the transaction'
);

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a1');

update public.transactions
set proof_url = '29000000-0000-0000-0000-0000000000a1/slip-2.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.nt_txn);

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a2');

select * from public.issue_rbin((select transaction_id from pg_temp.nt_txn));

-- Created as the administrator, so every impersonated role below can read it.
create temporary table nt_cert as
select id from public.certificates
where transaction_id = (select transaction_id from pg_temp.nt_txn);

select pg_temp.as_owner();

select is(
  pg_temp.kinds('29000000-0000-0000-0000-0000000000a1'),
  array['certificate_issued', 'membership_approved', 'payment_rejected'],
  'verifying and issuing together give one notification, not two'
);

select is(
  (select link from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'certificate_issued'),
  '/certificates/' || (select id from pg_temp.nt_cert),
  'which links to the certificate'
);

select matches(
  (select body from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'certificate_issued'),
  (select rbin from public.transactions where id = (select transaction_id from pg_temp.nt_txn)),
  'and names the RBIN'
);

-- ---------------------------------------------------------------------------
-- The branch pays the practitioner; a certificate is revoked and restored
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a2');

select public.record_remittance((select transaction_id from pg_temp.nt_txn), 'TRF-NTF-1');

select pg_temp.as_owner();

select matches(
  (select body from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1' and kind = 'share_paid'),
  '₦2,450,000.00 .*TRF-NTF-1',
  'the practitioner is told the share was sent, how much, and the reference'
);

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a2');

select public.revoke_certificate((select id from pg_temp.nt_cert), 'Issued in error');

-- Only a super administrator may reverse a revocation.
select pg_temp.impersonate('29000000-0000-0000-0000-0000000000c1');
select public.restore_certificate((select id from pg_temp.nt_cert));

select pg_temp.as_owner();

select is(
  pg_temp.kinds('29000000-0000-0000-0000-0000000000a1'),
  array['certificate_issued', 'certificate_restored', 'certificate_revoked',
        'membership_approved', 'payment_rejected', 'share_paid'],
  'revoking and restoring each notify once, and nothing else was raised'
);

-- ---------------------------------------------------------------------------
-- Nobody writes a notification, or reads another's
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a3');

select is(
  (select count(*)::int from public.notifications
   where user_id = '29000000-0000-0000-0000-0000000000a1'),
  0,
  'a practitioner cannot read another''s notifications'
);

select is(
  (select count(*)::int from public.notifications),
  1,
  'but reads their own'
);

select throws_ok(
  $$ insert into public.notifications (user_id, kind, title, body)
     values ('29000000-0000-0000-0000-0000000000a3', 'certificate_issued', 'Forged', 'Forged') $$,
  '42501',
  null,
  'a practitioner cannot write a notification'
);

select throws_ok(
  $$ update public.notifications set read_at = now() $$,
  '42501',
  null,
  'nor change one directly'
);

select throws_ok(
  $$ delete from public.notifications $$,
  '42501',
  null,
  'nor delete one'
);

select throws_ok(
  $$ select public.notify('29000000-0000-0000-0000-0000000000a3', 'certificate_issued',
       'Forged', 'Forged', '/') $$,
  '42501',
  null,
  'nor call the writer the triggers use'
);

select is(
  public.mark_notifications_read(
    array(select id from public.notifications
          where user_id = '29000000-0000-0000-0000-0000000000a1')),
  0,
  'marking someone else''s notifications read changes nothing'
);

-- ---------------------------------------------------------------------------
-- The owner marks theirs read
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a1');

select is(
  public.mark_notifications_read(
    array(select id from public.notifications where kind = 'membership_approved')),
  1,
  'the owner marks one read'
);

select is(
  public.mark_notifications_read(),
  5,
  'and then the rest at once'
);

select is(
  (select count(*)::int from public.notifications where read_at is null),
  0,
  'leaving nothing unread'
);

select pg_temp.impersonate('29000000-0000-0000-0000-0000000000a1', 'anon');

select throws_ok(
  $$ select public.mark_notifications_read() $$,
  '42501',
  null,
  'someone signed out cannot mark anything'
);

select * from finish();

rollback;
