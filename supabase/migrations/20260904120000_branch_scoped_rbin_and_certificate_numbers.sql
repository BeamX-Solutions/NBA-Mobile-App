-- Branch-scoped reference numbers, in the formats the branch's own
-- certificate uses.
--
-- Client decision, 4 September 2026:
--
--   RBIN               NBA/ANAOCHA/0240/2026   was NBA/2026/00001
--   Certificate number NBA/AN/CC/2026/00143    was NBA-CC-2026-0001
--
-- Both are now scoped to the issuing branch rather than drawn from one
-- national sequence. Two branches issuing on the same day no longer contend
-- for the same number, and a reference identifies its branch on sight.
--
-- The database column is still called bain. The branch calls the value an
-- RBIN and the certificate is labelled accordingly, but renaming the column
-- would reach into RLS policies, verify_bain, both clients and every QR code
-- already printed, for no behavioural gain. The rename can follow separately
-- if it is wanted.
--
-- Numbers already issued are not rewritten. NBA/2026/00001 keeps working,
-- because a certificate already in someone's hands must keep resolving; the
-- format changes for numbers issued from here on.

-- ---------------------------------------------------------------------------
-- branches.short_code
--
-- The certificate number uses AN where the RBIN uses ANAOCHA, so the two
-- identifiers are different lengths and the short one has to be stored rather
-- than derived. Taking the first two letters of the branch code would collide:
-- Abuja and Abeokuta both yield AB, and with per-branch sequences that would
-- produce two different certificates numbered NBA/AB/CC/2026/00001.
-- ---------------------------------------------------------------------------

alter table public.branches add column if not exists short_code text;

update public.branches
set short_code = upper(left(branch_code, 2))
where short_code is null;

alter table public.branches alter column short_code set not null;

alter table public.branches
  add constraint branches_short_code_key unique (short_code);

alter table public.branches
  add constraint branches_short_code_check
  check (short_code = upper(short_code) and short_code <> '' and length(short_code) <= 6);

comment on column public.branches.short_code is
  'Abbreviation used in certificate numbers, e.g. AN for ANAOCHA. Unique across branches: two branches sharing one abbreviation would issue colliding certificate numbers.';

-- ---------------------------------------------------------------------------
-- Formats
-- ---------------------------------------------------------------------------

-- The old two-argument signatures are dropped rather than left in place, so
-- nothing can call them and silently mint a national-format number.
drop function if exists public.format_bain(int, bigint);
drop function if exists public.format_certificate_number(int, bigint);

create or replace function public.format_bain(
  p_branch_code text, p_sequence bigint, p_year int
)
returns text
language sql
immutable
as $$
  select 'NBA/' || p_branch_code || '/' || lpad(p_sequence::text, 4, '0') || '/' || p_year::text;
$$;

create or replace function public.format_certificate_number(
  p_short_code text, p_year int, p_sequence bigint
)
returns text
language sql
immutable
as $$
  select 'NBA/' || p_short_code || '/CC/' || p_year::text || '/' || lpad(p_sequence::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- issue_bain: draw both numbers from per-branch sequences
-- ---------------------------------------------------------------------------

create or replace function public.issue_bain(p_transaction_id uuid)
returns table (bain text, certificate_number text, certificate_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_actor_branch uuid := public.current_user_branch();
  v_txn public.transactions%rowtype;
  v_branch public.branches%rowtype;
  v_year int := extract(year from now())::int;
  v_bain text;
  v_cert_number text;
  v_cert_id uuid;
begin
  select * into v_txn from public.transactions where id = p_transaction_id for update;

  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;

  if not public.is_service_actor() then
    if v_role not in ('branch_admin', 'super_admin') then
      raise exception 'Only a branch administrator may issue a BAIN' using errcode = '42501';
    end if;

    if v_role = 'branch_admin' and v_txn.branch_id is distinct from v_actor_branch then
      raise exception 'This transaction belongs to another branch' using errcode = '42501';
    end if;

    if v_txn.user_id = v_actor then
      raise exception 'You cannot approve your own submission. Another administrator must review it.'
        using errcode = '42501';
    end if;
  end if;

  if v_txn.status <> 'pending_verification' then
    raise exception 'Only a transaction awaiting verification can be approved (current status: %)',
      v_txn.status using errcode = '22023';
  end if;

  if v_txn.bain is not null then
    raise exception 'This transaction already has BAIN %', v_txn.bain using errcode = '23505';
  end if;

  -- The issuing branch supplies both abbreviations, so a reference always
  -- names the branch that granted it.
  select * into v_branch from public.branches where id = v_txn.branch_id;
  if not found then
    raise exception 'The issuing branch could not be found' using errcode = 'P0002';
  end if;

  -- Sequences are per branch per year. A national scope would make one
  -- branch's issuance advance every other branch's numbering.
  v_bain := public.format_bain(
    v_branch.branch_code,
    public.next_sequence_value('rbin:' || v_branch.branch_code || ':' || v_year::text),
    v_year
  );
  v_cert_number := public.format_certificate_number(
    v_branch.short_code,
    v_year,
    public.next_sequence_value('certificate:' || v_branch.branch_code || ':' || v_year::text)
  );

  perform set_config('app.issuing_bain', 'on', true);

  update public.transactions
  set status = 'verified',
      verified_by = v_actor,
      verified_at = now(),
      rejection_reason = null,
      bain = v_bain,
      bain_issued_at = now()
  where id = p_transaction_id;

  perform set_config('app.issuing_bain', 'off', true);

  insert into public.certificates (transaction_id, certificate_number)
  values (p_transaction_id, v_cert_number)
  returning id into v_cert_id;

  return query select v_bain, v_cert_number, v_cert_id;
end;
$$;

revoke execute on function public.issue_bain(uuid) from public, anon;
grant execute on function public.issue_bain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- list_branches_for_signup already returns the fields the registration screen
-- needs; short_code is deliberately not among them, because it is an internal
-- numbering detail rather than something a practitioner chooses by.
-- ---------------------------------------------------------------------------
