-- Subscriptions are bought through Paystack.
--
-- Until now nothing could create a subscription: the schema left every write
-- to "a server side webhook" that did not exist, and create_transaction
-- refuses an invoice without one. This is that server side.
--
-- The flow, with the Edge Functions in supabase/functions:
--
--   1. subscription-checkout calls begin_subscription_payment() as the
--      practitioner. It checks they may buy, prices the plan here, and records
--      a pending payment under a fresh reference before Paystack hears of it.
--   2. The practitioner pays on Paystack's checkout page.
--   3. paystack-webhook (signed by Paystack) or subscription-confirm (the
--      practitioner, back from checkout) asks Paystack's verify API about the
--      reference, and only if Paystack says it succeeded, in naira, for the
--      recorded amount, calls record_subscription_payment() as the service
--      role. Both paths end there, and it is idempotent on the reference.
--
-- Why record the payment first: anybody holding the public key can start a
-- Paystack payment against this account with whatever amount and metadata
-- they like. A reference this database did not issue grants nothing, and one
-- it did issue grants only the plan it was issued for, at its price.

-- ---------------------------------------------------------------------------
-- The price list
-- ---------------------------------------------------------------------------
--
-- The client's prices, set 10 October 2026, in kobo. mobile/lib/plans.ts and
-- the practitioner web app's lib/plans.ts show the same figures; they display
-- them, this charges them. Weekly is withdrawn and has no price, so it cannot
-- be bought.

create function public.subscription_price(p_plan public.subscription_plan)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case p_plan
    when 'monthly' then 3000000
    when 'quarterly' then 8500000
    when 'yearly' then 30000000
  end::bigint;
$$;

create function public.subscription_term(p_plan public.subscription_plan)
returns interval
language sql
immutable
set search_path = public
as $$
  select case p_plan
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'yearly' then interval '1 year'
  end;
$$;

-- ---------------------------------------------------------------------------
-- subscription_payments: every checkout, from the moment it is started
-- ---------------------------------------------------------------------------

create type public.subscription_payment_status as enum ('pending', 'paid', 'failed');

create table public.subscription_payments (
  reference text primary key,
  user_id uuid not null references public.profiles (id),
  plan public.subscription_plan not null,
  amount bigint not null check (amount > 0),
  status public.subscription_payment_status not null default 'pending',
  subscription_id uuid references public.subscriptions (id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status = 'paid') = (subscription_id is not null))
);

create index subscription_payments_user_idx on public.subscription_payments (user_id, created_at desc);

alter table public.subscription_payments enable row level security;

-- The practitioner reads their own, so the confirm page can say what it is
-- waiting for. Every write is a function's.
create policy "users read own subscription payments" on public.subscription_payments
  for select to authenticated using (user_id = auth.uid());

create policy "super admin reads all subscription payments" on public.subscription_payments
  for select to authenticated using (public.is_privileged_actor());

revoke all on public.subscription_payments from public, anon, authenticated;
grant select on public.subscription_payments to authenticated;

-- ---------------------------------------------------------------------------
-- begin_subscription_payment: the practitioner starts a checkout
-- ---------------------------------------------------------------------------
--
-- Security definer because practitioners have no insert on
-- subscription_payments. It acts only for auth.uid(), so it can start a
-- checkout for nobody but the caller.

create function public.begin_subscription_payment(p_plan public.subscription_plan)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles;
  v_amount bigint := public.subscription_price(p_plan);
  v_reference text;
begin
  if v_actor is null then
    raise exception 'Sign in to subscribe' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Your profile could not be found' using errcode = 'P0002';
  end if;

  if v_profile.role not in ('branch_member', 'branch_admin') then
    raise exception 'Only practitioners subscribe. A super administrator belongs to no branch and cannot generate invoices.'
      using errcode = '42501';
  end if;

  if v_profile.membership_status <> 'approved' then
    raise exception 'Your branch has not approved your membership yet. You can subscribe once it has.'
      using errcode = 'P0001';
  end if;

  if v_amount is null then
    raise exception 'That plan is not on sale' using errcode = '22023';
  end if;

  -- Paystack allows letters, digits, "-", "." and "="; 36 characters is well
  -- inside its limit.
  v_reference := 'NBA-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.subscription_payments (reference, user_id, plan, amount)
  values (v_reference, v_actor, p_plan, v_amount);

  return jsonb_build_object(
    'reference', v_reference,
    'amount', v_amount,
    'email', v_profile.email
  );
end;
$$;

revoke execute on function public.begin_subscription_payment(public.subscription_plan) from public, anon;
grant execute on function public.begin_subscription_payment(public.subscription_plan) to authenticated;

-- ---------------------------------------------------------------------------
-- record_subscription_payment: the server grants what was paid for
-- ---------------------------------------------------------------------------
--
-- Called by the Edge Functions as the service role, only after Paystack's
-- verify API has confirmed the reference. p_amount is what Paystack says was
-- paid; it must equal what this database priced, or nothing is granted.
--
-- Renewing early keeps the unused time. The unique index allows one active row
-- per practitioner, so the current row is closed, as 'cancelled', and the new
-- one runs from now to the old expiry plus the term. A row still marked active
-- after it lapsed, which nothing else tidies, is closed as 'expired' and
-- carries nothing.
--
-- Returns the payment as it now stands, so a repeated call (a webhook resent,
-- or a webhook and a confirm racing) gets the same answer and grants nothing
-- twice.

create function public.record_subscription_payment(
  p_reference text,
  p_amount bigint,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payment public.subscription_payments;
  v_carry_from timestamptz;
  v_subscription public.subscriptions;
begin
  if not public.is_service_actor() then
    raise exception 'Only the server records a payment' using errcode = '42501';
  end if;

  select * into v_payment from public.subscription_payments
  where reference = p_reference
  for update;
  if not found then
    raise exception 'No checkout was started under that reference' using errcode = 'P0002';
  end if;

  if v_payment.status = 'paid' then
    select * into v_subscription from public.subscriptions where id = v_payment.subscription_id;
    return jsonb_build_object(
      'status', 'paid',
      'subscription_id', v_subscription.id,
      'expires_at', v_subscription.expires_at
    );
  end if;

  if p_amount is distinct from v_payment.amount then
    raise exception 'Paid % kobo against a price of % kobo', p_amount, v_payment.amount
      using errcode = '22023';
  end if;

  update public.subscriptions set status = 'expired'
  where user_id = v_payment.user_id and status = 'active' and expires_at <= now();

  select max(expires_at) into v_carry_from
  from public.subscriptions
  where user_id = v_payment.user_id and status = 'active';

  update public.subscriptions set status = 'cancelled'
  where user_id = v_payment.user_id and status = 'active';

  insert into public.subscriptions
    (user_id, plan, rate_type, amount, starts_at, expires_at, status, paystack_reference)
  values (
    v_payment.user_id,
    v_payment.plan,
    'standard',
    v_payment.amount,
    now(),
    greatest(now(), coalesce(v_carry_from, now())) + public.subscription_term(v_payment.plan),
    'active',
    v_payment.reference
  )
  returning * into v_subscription;

  update public.subscription_payments
  set status = 'paid', subscription_id = v_subscription.id, paid_at = coalesce(p_paid_at, now())
  where reference = p_reference;

  return jsonb_build_object(
    'status', 'paid',
    'subscription_id', v_subscription.id,
    'expires_at', v_subscription.expires_at
  );
end;
$$;

revoke execute on function public.record_subscription_payment(text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.record_subscription_payment(text, bigint, timestamptz) to service_role;

-- A checkout Paystack reports as failed. A failed checkout may still be paid:
-- Paystack lets the practitioner retry under the same reference, so
-- record_subscription_payment accepts a failed payment as readily as a pending
-- one, and only 'paid' is final. Abandoned (never completed) leaves it pending.
create function public.fail_subscription_payment(p_reference text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_service_actor() then
    raise exception 'Only the server records a payment' using errcode = '42501';
  end if;

  update public.subscription_payments set status = 'failed'
  where reference = p_reference and status = 'pending';
end;
$$;

revoke execute on function public.fail_subscription_payment(text) from public, anon, authenticated;
grant execute on function public.fail_subscription_payment(text) to service_role;
