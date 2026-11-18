-- The personal assistant: who may ask, how often, and that every tool answers
-- with the caller's own records only.
--
-- The case that matters most is the branch administrator who also practises.
-- Row level security lets them read their whole branch's transactions, so a
-- tool that leaned on row level security alone would hand them their
-- members' work when they ask "what is pending for me?".

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

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
-- Branch A: an administrator who practises (one invoice of their own),
--   practitioner 1 with one invoice in each state and a certificate,
--   practitioner 2 with no subscription.
-- A super administrator.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1c000000-0000-0000-0000-0000000000aa', 'Ask A Branch', 'ASKA', 'Anambra', 'Q1', 'A Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2c000000-0000-0000-0000-0000000000a1', 'ask.admin@example.com',
   '{"full_name": "Ask Admin", "scn": "ASK0001", "branch_code": "ASKA"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000a2', 'ask.one@example.com',
   '{"full_name": "Ask One", "scn": "ASK0002", "branch_code": "ASKA"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000a3', 'ask.two@example.com',
   '{"full_name": "Ask Two", "scn": "ASK0003", "branch_code": "ASKA"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000c1', 'ask.super@example.com',
   '{"full_name": "Ask Super", "scn": "ASK0004", "branch_code": "ASKA"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id::text like '2c000000-%';

update public.profiles set role = 'branch_admin'
where id = '2c000000-0000-0000-0000-0000000000a1';

update public.profiles set role = 'super_admin', branch_id = null
where id = '2c000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at) values
  ('2c000000-0000-0000-0000-0000000000a1', 'monthly', 'standard', 3000000, now() - interval '1 day', now() + interval '29 days'),
  ('2c000000-0000-0000-0000-0000000000a2', 'monthly', 'standard', 3000000, now() - interval '25 days', now() + interval '5 days');

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee,
   status, rejection_reason, verified_at, rbin, invoice_number) values
  ('3c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-0000000000a2',
   '1c000000-0000-0000-0000-0000000000aa', 'Okafor to Eze', 'deed_of_assignment', 100000000, 10000000, 200000,
   'awaiting_payment', null, null, null, 'TXN-ASK-0001'),
  ('3c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-0000000000a2',
   '1c000000-0000-0000-0000-0000000000aa', 'Nnaji to Obi', 'mortgage_deed', 100000000, 4000000, 80000,
   'pending_verification', null, null, null, 'TXN-ASK-0002'),
  ('3c000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-0000000000a2',
   '1c000000-0000-0000-0000-0000000000aa', 'Ude to Ani', 'deed_of_gift', 100000000, 10000000, 200000,
   'rejected', 'The slip is unreadable', null, null, 'TXN-ASK-0003'),
  ('3c000000-0000-0000-0000-000000000004', '2c000000-0000-0000-0000-0000000000a2',
   '1c000000-0000-0000-0000-0000000000aa', 'Ike to Uche', 'deed_of_assignment', 100000000, 10000000, 200000,
   'verified', null, now(), 'RBIN-ASK-0004', 'TXN-ASK-0004'),
  ('3c000000-0000-0000-0000-000000000005', '2c000000-0000-0000-0000-0000000000a1',
   '1c000000-0000-0000-0000-0000000000aa', 'Admin own work', 'deed_of_lease', 100000000, 10000000, 200000,
   'awaiting_payment', null, null, null, 'TXN-ASK-0005'),
  ('3c000000-0000-0000-0000-000000000006', '2c000000-0000-0000-0000-0000000000a3',
   '1c000000-0000-0000-0000-0000000000aa', 'Two to Three', 'deed_of_assignment', 100000000, 10000000, 200000,
   'pending_verification', null, null, null, 'TXN-ASK-0006');

insert into public.certificates (id, transaction_id, certificate_number) values
  ('4c000000-0000-0000-0000-000000000004', '3c000000-0000-0000-0000-000000000004', 'CERT-ASK-0004');

-- ---------------------------------------------------------------------------
-- Tools answer with the practitioner's own work
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a2');

select is(
  (select jsonb_build_array(
     jsonb_array_length(p -> 'invoices_awaiting_payment_proof'),
     jsonb_array_length(p -> 'proofs_waiting_for_branch'),
     jsonb_array_length(p -> 'proofs_rejected'),
     jsonb_array_length(p -> 'verified_but_share_not_yet_paid'))
   from public.assistant_pending_items() p),
  '[1, 1, 1, 1]'::jsonb,
  'pending_items finds one invoice in each pending state'
);

select is(
  public.assistant_pending_items() #>> '{proofs_rejected,0,rejection_reason}',
  'The slip is unreadable',
  'and carries the branch''s reason for a rejection'
);

select isnt(
  public.assistant_pending_items() -> 'subscription_ending_soon',
  'null'::jsonb,
  'and warns of a subscription ending within 7 days'
);

select is(
  (public.assistant_list_transactions() ->> 'total')::int,
  4,
  'list_transactions counts the practitioner''s four invoices and nobody else''s'
);

select is(
  (public.assistant_list_transactions(p_search => 'okafor') ->> 'total')::int,
  1,
  'and finds one by the parties'
);

select is(
  public.assistant_get_transaction('rbin-ask-0004') #>> '{certificate,number}',
  'CERT-ASK-0004',
  'get_transaction finds a transaction by RBIN, with its certificate'
);

select is(
  (public.assistant_spend_summary(current_date - 1, current_date + 1) ->> 'invoices')::int,
  4,
  'spend_summary covers the period'
);

select is(
  public.assistant_quote_fee('deed_of_assignment', 100000000) ->> 'prescribed_minimum_fee',
  '₦100,000.00',
  'quote_fee takes the fee from the server''s engine: 10% of ₦1m'
);

select ok(
  public.assistant_quote_fee('power_of_attorney', 100000000) ? 'error',
  'and explains a document Scale 4 does not cover instead of failing'
);

-- ---------------------------------------------------------------------------
-- A branch administrator who practises sees only their own
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a1');

select is(
  (select count(*)::int from public.transactions),
  6,
  'row level security alone shows the administrator the whole branch'
);

select is(
  public.assistant_pending_items() -> 'invoices_awaiting_payment_proof' -> 0 ->> 'invoice_number',
  'TXN-ASK-0005',
  'but pending_items shows them only their own invoice'
);

select is(
  jsonb_array_length(public.assistant_pending_items() -> 'proofs_waiting_for_branch'),
  0,
  'and none of their members'' proofs'
);

select is(
  (public.assistant_list_transactions() ->> 'total')::int,
  1,
  'list_transactions counts only their own'
);

select is(
  public.assistant_get_transaction('TXN-ASK-0004'),
  '{"found": false}'::jsonb,
  'get_transaction will not open a member''s transaction'
);

select is(
  jsonb_array_length(public.assistant_list_certificates() -> 'certificates'),
  0,
  'list_certificates will not list a member''s certificate'
);

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a3');

select throws_ok(
  $$ select public.assistant_begin_turn('What is pending for me?') $$,
  'PT402',
  null,
  'a practitioner without a subscription is sent to the plans'
);

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.assistant_begin_turn('What is pending for me?') $$,
  'PT403',
  null,
  'a super administrator has no work of their own to ask about'
);

select ok(
  not has_function_privilege('anon', 'public.assistant_pending_items()', 'execute'),
  'nobody signed out can call a tool'
);

-- ---------------------------------------------------------------------------
-- The conversation
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a2');

select is(
  public.assistant_begin_turn('  What is pending for me?  ') #>> '{history,-1,content}',
  'What is pending for me?',
  'a subscriber''s message is recorded and closes the history'
);

select throws_ok(
  $$ insert into public.chat_messages (user_id, role, content)
     values ('2c000000-0000-0000-0000-0000000000a2', 'assistant', 'Your certificate is issued') $$,
  '42501',
  null,
  'nobody writes the conversation directly'
);

select lives_ok(
  $$ select public.assistant_finish_turn(
       (select id from public.chat_messages where role = 'user' order by created_at desc limit 1),
       'You have one invoice awaiting payment.') $$,
  'the reply to a practitioner''s own message is recorded'
);

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a1');

select is(
  (select count(*)::int from public.chat_messages),
  0,
  'nobody else can read it, not even the branch administrator'
);

-- ---------------------------------------------------------------------------
-- Clearing hides the conversation but does not reset the rate limit
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a2');
select public.assistant_clear_conversation();

select is(
  (select count(*)::int from public.chat_messages),
  0,
  'a cleared conversation is hidden from its owner'
);

select set_config('role', 'postgres', true);
insert into public.chat_messages (user_id, role, content)
select '2c000000-0000-0000-0000-0000000000a2', 'user', 'question ' || n
from generate_series(1, 19) n;

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.assistant_begin_turn('One more?') $$,
  'PT429',
  null,
  'the twenty-first message in an hour is refused, cleared messages included'
);

select * from finish();

rollback;
