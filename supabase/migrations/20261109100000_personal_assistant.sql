-- A personal assistant: practitioners ask questions about their own work.
--
-- Planned with the user on 9 November 2026 (SPEC.md section 12):
--
--   * Personal, not a pool. Every answer is about the person asking and
--     nobody else. "What is pending for me?" returns that practitioner's
--     pending items only.
--   * Paying subscribers only, checked here on every message.
--   * Read only. The assistant explains and links; it changes nothing.
--
-- HOW THE SCOPE IS HELD. Row level security is not enough on its own: a
-- branch administrator may read the whole branch's transactions, and a super
-- administrator everyone's, and administrators also practise. So every tool
-- below filters on user_id = auth.uid() itself, and runs as the caller
-- (security invoker) so row level security still applies beneath that
-- filter. The Edge Function calls them with the practitioner's own token and
-- never holds the service role key.
--
-- The model never does arithmetic on money. Every amount leaves here both in
-- kobo and already written in naira.

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  -- An assistant row answers exactly one user row.
  reply_to uuid references public.chat_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Cleared conversations are hidden, not deleted, so clearing does not reset
  -- the rate limit.
  cleared_at timestamptz,
  check ((role = 'assistant') = (reply_to is not null))
);

comment on table public.chat_messages is
  'The personal assistant conversation. Written only through assistant_begin_turn and assistant_finish_turn; the owner reads it.';

create index chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

create unique index chat_messages_one_reply_idx
  on public.chat_messages (reply_to)
  where reply_to is not null;

alter table public.chat_messages enable row level security;

create policy "Owners read their conversation"
  on public.chat_messages for select
  to authenticated
  using (user_id = auth.uid() and cleared_at is null);

grant select on public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.assistant_naira(p_kobo numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_kobo is null then null
    else '₦' || to_char(p_kobo / 100.0, 'FM999,999,999,999,990.00') end;
$$;

create function public.assistant_document_label(p_type public.document_type)
returns text
language sql
immutable
set search_path = public
as $$
  select initcap(replace(p_type::text, '_', ' '));
$$;

-- Whether the caller may use the assistant. Raises the reason when not.
-- PT-prefixed codes become the HTTP status of the PostgREST response.
create function public.assistant_require_entitlement()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to use the assistant.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.role = 'super_admin' then
    raise exception 'The assistant answers questions about a practitioner''s own work, and a super administrator account has none.'
      using errcode = 'PT403';
  end if;

  if v_profile.membership_status <> 'approved' then
    raise exception 'The assistant opens once your branch has approved your membership.'
      using errcode = 'PT403';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'The assistant comes with a subscription. Choose a plan to start using it.'
      using errcode = 'PT402';
  end if;
end;
$$;

revoke execute on function public.assistant_require_entitlement() from public, anon;
grant execute on function public.assistant_require_entitlement() to authenticated;

-- ---------------------------------------------------------------------------
-- Turns
-- ---------------------------------------------------------------------------

-- Records the practitioner's message and returns the conversation to send to
-- the model: the most recent visible messages, oldest first, ending with this
-- one. Refuses when the caller is not entitled or has sent too many.
create function public.assistant_begin_turn(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Generous for a person, tight for a script.
  c_per_hour constant int := 20;
  c_per_day constant int := 100;
  c_history constant int := 20;
  v_actor uuid := auth.uid();
  v_message text := nullif(trim(p_message), '');
  v_id uuid;
begin
  perform public.assistant_require_entitlement();

  if v_message is null then
    raise exception 'Type a question first.' using errcode = '22023';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'That message is too long. Keep it under 2,000 characters.' using errcode = '22023';
  end if;

  -- Counted over cleared messages too.
  if (select count(*) from public.chat_messages
      where user_id = v_actor and role = 'user'
        and created_at > now() - interval '1 hour') >= c_per_hour then
    raise exception 'You have asked a lot in the last hour. Please try again a little later.'
      using errcode = 'PT429';
  end if;
  if (select count(*) from public.chat_messages
      where user_id = v_actor and role = 'user'
        and created_at > now() - interval '1 day') >= c_per_day then
    raise exception 'You have reached today''s limit for the assistant. It resets within a day.'
      using errcode = 'PT429';
  end if;

  insert into public.chat_messages (user_id, role, content)
  values (v_actor, 'user', v_message)
  returning id into v_id;

  return jsonb_build_object(
    'message_id', v_id,
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at, role desc), '[]'::jsonb)
      from (
        select role, content, created_at
        from public.chat_messages
        where user_id = v_actor and cleared_at is null
        order by created_at desc, role
        limit c_history
      ) recent
    )
  );
end;
$$;

revoke execute on function public.assistant_begin_turn(text) from public, anon;
grant execute on function public.assistant_begin_turn(text) to authenticated;

-- Records the assistant's reply to one of the caller's own messages, once.
create function public.assistant_finish_turn(p_message_id uuid, p_reply text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reply text := nullif(trim(p_reply), '');
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in to use the assistant.' using errcode = '42501';
  end if;
  if v_reply is null then
    raise exception 'The reply is empty.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.chat_messages
    where id = p_message_id and user_id = v_actor and role = 'user'
  ) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  insert into public.chat_messages (user_id, role, content, reply_to)
  values (v_actor, 'assistant', left(v_reply, 8000), p_message_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.assistant_finish_turn(uuid, text) from public, anon;
grant execute on function public.assistant_finish_turn(uuid, text) to authenticated;

create function public.assistant_clear_conversation()
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_messages
  set cleared_at = now()
  where user_id = auth.uid() and cleared_at is null;
$$;

revoke execute on function public.assistant_clear_conversation() from public, anon;
grant execute on function public.assistant_clear_conversation() to authenticated;

-- ---------------------------------------------------------------------------
-- Tools. Each runs as the caller and filters on the caller's own user_id.
-- ---------------------------------------------------------------------------

create function public.assistant_transaction_json(t public.transactions)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'link', '/transactions/' || t.id,
    'invoice_number', t.invoice_number,
    'document', public.assistant_document_label(t.document_type),
    'parties', t.parties,
    'property', t.property_description,
    'status', t.status,
    'consideration', public.assistant_naira(t.consideration),
    'amount_payable', public.assistant_naira(t.amount_payable),
    'branch_fee', public.assistant_naira(t.branch_fee),
    'due_to_you', public.assistant_naira(t.due_to_practitioner),
    'rejection_reason', t.rejection_reason,
    'rbin', t.rbin,
    'created_on', (t.created_at at time zone 'Africa/Lagos')::date,
    'verified_on', (t.verified_at at time zone 'Africa/Lagos')::date,
    'share_paid', t.payout_id is not null or t.remitted_at is not null
  );
$$;

create function public.assistant_pending_items()
returns jsonb
language sql
stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select jsonb_build_object(
    'invoices_awaiting_payment_proof', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'awaiting_payment'),
    'proofs_waiting_for_branch', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'pending_verification'),
    'proofs_rejected', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'rejected'),
    'verified_but_share_not_yet_paid', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.verified_at), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'verified'
        and t.payout_id is null and t.remitted_at is null),
    'membership', (
      select case p.membership_status
        when 'approved' then null
        else jsonb_build_object('status', p.membership_status, 'reason', p.membership_rejection_reason) end
      from public.profiles p, me where p.id = me.id),
    'subscription_ending_soon', (
      select jsonb_build_object('plan', s.plan, 'expires_on', (s.expires_at at time zone 'Africa/Lagos')::date)
      from public.subscriptions s, me
      where s.user_id = me.id and s.status = 'active'
        and s.expires_at > now() and s.expires_at <= now() + interval '7 days')
  );
$$;

-- The caller's own transactions matching the filters. Returns real
-- transactions rows, so assistant_transaction_json can take them whole.
create function public.assistant_my_transactions(
  p_status public.transaction_status default null,
  p_from date default null,
  p_to date default null,
  p_document_type public.document_type default null,
  p_search text default null
)
returns setof public.transactions
language sql
stable
set search_path = public
as $$
  select t.*
  from public.transactions t
  where t.user_id = auth.uid()
    and (p_status is null or t.status = p_status)
    and (p_document_type is null or t.document_type = p_document_type)
    and (p_from is null or (t.created_at at time zone 'Africa/Lagos')::date >= p_from)
    and (p_to is null or (t.created_at at time zone 'Africa/Lagos')::date <= p_to)
    and (nullif(trim(p_search), '') is null
         or t.parties ilike '%' || trim(p_search) || '%'
         or t.property_description ilike '%' || trim(p_search) || '%');
$$;

create function public.assistant_list_transactions(
  p_status public.transaction_status default null,
  p_from date default null,
  p_to date default null,
  p_document_type public.document_type default null,
  p_search text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*)
              from public.assistant_my_transactions(p_status, p_from, p_to, p_document_type, p_search)),
    'transactions', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from (select * from public.assistant_my_transactions(p_status, p_from, p_to, p_document_type, p_search) m
            order by m.created_at desc limit 25) ids
      join public.transactions t using (id)),
    'note', 'At most the 25 most recent are listed.'
  );
$$;

-- By id, invoice number (TXN-00001-DOA) or RBIN.
create function public.assistant_get_transaction(p_reference text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce((
    select public.assistant_transaction_json(t) || jsonb_build_object(
      'certificate', (
        select jsonb_build_object(
          'number', c.certificate_number,
          'link', '/certificates/' || c.id,
          'issued_on', (c.issued_at at time zone 'Africa/Lagos')::date,
          'revoked', c.revoked_at is not null,
          'revocation_reason', c.revocation_reason)
        from public.certificates c where c.transaction_id = t.id))
    from public.transactions t
    where t.user_id = auth.uid()
      and (t.id::text = trim(p_reference)
           or upper(t.invoice_number) = upper(trim(p_reference))
           or upper(t.rbin) = upper(trim(p_reference)))
    limit 1
  ), jsonb_build_object('found', false));
$$;

create function public.assistant_list_certificates(p_include_revoked boolean default true)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('certificates', coalesce(jsonb_agg(jsonb_build_object(
      'number', c.certificate_number,
      'link', '/certificates/' || c.id,
      'issued_on', (c.issued_at at time zone 'Africa/Lagos')::date,
      'revoked', c.revoked_at is not null,
      'revocation_reason', c.revocation_reason,
      'rbin', t.rbin,
      'document', public.assistant_document_label(t.document_type),
      'parties', t.parties
    ) order by c.issued_at desc), '[]'::jsonb))
  from public.certificates c
  join public.transactions t on t.id = c.transaction_id
  where t.user_id = auth.uid()
    and (p_include_revoked or c.revoked_at is null);
$$;

-- Invoices raised in the period, by status and by document.
create function public.assistant_spend_summary(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (
    select t.*
    from public.transactions t
    where t.user_id = auth.uid()
      and (t.created_at at time zone 'Africa/Lagos')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'invoices', (select count(*) from mine),
    'verified', (select jsonb_build_object(
        'count', count(*),
        'amount_paid_into_branch', public.assistant_naira(coalesce(sum(amount_payable), 0)),
        'branch_fees', public.assistant_naira(coalesce(sum(branch_fee), 0)),
        'due_to_you', public.assistant_naira(coalesce(sum(due_to_practitioner), 0)))
      from mine where status = 'verified'),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) as n from mine group by status) s),
    'by_document', (select coalesce(jsonb_agg(jsonb_build_object(
        'document', public.assistant_document_label(document_type),
        'count', n,
        'amount_payable', public.assistant_naira(total)) order by total desc), '[]'::jsonb)
      from (select document_type, count(*) as n, sum(amount_payable) as total
            from mine group by document_type) d)
  );
$$;

create function public.assistant_payouts(p_from date default null, p_to date default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (
    select p.*
    from public.payouts p
    where p.user_id = auth.uid()
      and (p_from is null or (p.recorded_at at time zone 'Africa/Lagos')::date >= p_from)
      and (p_to is null or (p.recorded_at at time zone 'Africa/Lagos')::date <= p_to)
  )
  select jsonb_build_object(
    'total_received', public.assistant_naira((select coalesce(sum(amount), 0) from mine)),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object(
        'amount', public.assistant_naira(m.amount),
        'paid_to', m.paid_to,
        'reference', m.reference,
        'paid_on', (m.recorded_at at time zone 'Africa/Lagos')::date,
        'invoices', (select coalesce(jsonb_agg(t.invoice_number order by t.invoice_number), '[]'::jsonb)
                     from public.transactions t where t.payout_id = m.id and t.user_id = auth.uid())
      ) order by m.recorded_at desc), '[]'::jsonb)
      from (select * from mine order by recorded_at desc limit 25) m),
    'link', '/payments'
  );
$$;

create function public.assistant_subscription()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'plan', s.plan,
      'status', case when s.status = 'active' and s.expires_at > now() then 'active' else 'expired' end,
      'started_on', (s.starts_at at time zone 'Africa/Lagos')::date,
      'expires_on', (s.expires_at at time zone 'Africa/Lagos')::date,
      'renewal_open', s.expires_at <= now() + interval '7 days')
    from public.subscriptions s
    where s.user_id = auth.uid()
    order by s.expires_at desc
    limit 1
  ), jsonb_build_object('status', 'none'));
$$;

-- The prescribed minimum from the server's own fee function.
create function public.assistant_quote_fee(p_document_type public.document_type, p_consideration_kobo bigint)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_fee bigint;
  v_branch bigint;
begin
  v_fee := public.professional_fee_for(p_document_type, p_consideration_kobo);
  v_branch := public.branch_fee_for(v_fee);
  return jsonb_build_object(
    'document', public.assistant_document_label(p_document_type),
    'consideration', public.assistant_naira(p_consideration_kobo),
    'prescribed_minimum_fee', public.assistant_naira(v_fee),
    'branch_fee', public.assistant_naira(v_branch),
    'net_to_you', public.assistant_naira(v_fee - v_branch),
    'note', 'Scale 4 of the Legal Practitioners Remuneration Order 2023. This is the minimum; it is not negotiable downward without the Bar Remuneration Committee.');
exception
  when sqlstate '22023' then
    return jsonb_build_object('error', sqlerrm);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'assistant_naira(numeric)',
    'assistant_document_label(public.document_type)',
    'assistant_transaction_json(public.transactions)',
    'assistant_pending_items()',
    'assistant_my_transactions(public.transaction_status, date, date, public.document_type, text)',
    'assistant_list_transactions(public.transaction_status, date, date, public.document_type, text)',
    'assistant_get_transaction(text)',
    'assistant_list_certificates(boolean)',
    'assistant_spend_summary(date, date)',
    'assistant_payouts(date, date)',
    'assistant_subscription()',
    'assistant_quote_fee(public.document_type, bigint)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
