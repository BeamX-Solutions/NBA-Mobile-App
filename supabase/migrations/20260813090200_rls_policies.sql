-- Phase 1: row level security. Every table is locked down; access is granted
-- policy by policy. The service role bypasses RLS; the triggers in the
-- previous migration still constrain what authenticated clients can write.

alter table public.state_bands enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.fee_scales enable row level security;
alter table public.fee_scale_bands enable row level security;
alter table public.subscriptions enable row level security;
alter table public.calculations enable row level security;
alter table public.transactions enable row level security;
alter table public.certificates enable row level security;
alter table public.audit_log enable row level security;
alter table public.number_sequences enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data: readable by everyone including anonymous clients, so the
-- calculator can cache the scale for offline use. Writes: super admin only.
-- ---------------------------------------------------------------------------

create policy "state bands are public" on public.state_bands
  for select to anon, authenticated using (true);

create policy "super admin manages state bands" on public.state_bands
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

create policy "fee scales are public" on public.fee_scales
  for select to anon, authenticated using (true);

create policy "super admin manages fee scales" on public.fee_scales
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

create policy "fee scale bands are public" on public.fee_scale_bands
  for select to anon, authenticated using (true);

create policy "super admin manages fee scale bands" on public.fee_scale_bands
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- branches: any signed-in user can read (receipts display branch bank
-- details). Branch admins update their own branch; the column-protection
-- trigger keeps activation fields out of reach. Only the super admin
-- creates branches.
-- ---------------------------------------------------------------------------

create policy "authenticated users read branches" on public.branches
  for select to authenticated using (true);

create policy "branch admin updates own branch" on public.branches
  for update to authenticated
  using (
    public.current_user_role() = 'super_admin'
    or (public.current_user_role() = 'branch_admin' and id = public.current_user_branch())
  )
  with check (
    public.current_user_role() = 'super_admin'
    or (public.current_user_role() = 'branch_admin' and id = public.current_user_branch())
  );

create policy "super admin creates branches" on public.branches
  for insert to authenticated
  with check (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- profiles: own row always; branch admins see their members; super admin all.
-- Inserts happen only via the auth trigger (security definer). No deletes.
-- ---------------------------------------------------------------------------

create policy "users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "branch admin reads member profiles" on public.profiles
  for select to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and branch_id is not null
    and branch_id = public.current_user_branch()
  );

create policy "super admin reads all profiles" on public.profiles
  for select to authenticated using (public.current_user_role() = 'super_admin');

create policy "users update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "super admin updates profiles" on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- subscriptions: read your own. All writes come from the server after a
-- verified Paystack webhook, so there are no client write policies at all.
-- ---------------------------------------------------------------------------

create policy "users read own subscriptions" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

create policy "super admin reads all subscriptions" on public.subscriptions
  for select to authenticated using (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- calculations: private to their owner. Insert requires ownership.
-- ---------------------------------------------------------------------------

create policy "users read own calculations" on public.calculations
  for select to authenticated using (user_id = auth.uid());

create policy "users create own calculations" on public.calculations
  for insert to authenticated with check (user_id = auth.uid());

create policy "super admin reads all calculations" on public.calculations
  for select to authenticated using (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- transactions: owners and their branch's admins. The lifecycle trigger
-- decides which updates are legal; these policies decide who may attempt one.
-- No delete policies: transactions are permanent records.
-- ---------------------------------------------------------------------------

create policy "users read own transactions" on public.transactions
  for select to authenticated using (user_id = auth.uid());

create policy "branch admin reads branch transactions" on public.transactions
  for select to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  );

create policy "super admin reads all transactions" on public.transactions
  for select to authenticated using (public.current_user_role() = 'super_admin');

create policy "users create own transactions" on public.transactions
  for insert to authenticated with check (user_id = auth.uid());

create policy "owner updates own transaction" on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "branch admin updates branch transactions" on public.transactions
  for update to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  )
  with check (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  );

-- ---------------------------------------------------------------------------
-- certificates: visible to the transaction owner and the issuing branch's
-- admins. Issued certificates stay downloadable regardless of subscription
-- status (SPEC.md question 8 recommendation). Writes are server side only.
-- ---------------------------------------------------------------------------

create policy "owner reads own certificates" on public.certificates
  for select to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.user_id = auth.uid()
    )
  );

create policy "branch admin reads branch certificates" on public.certificates
  for select to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.branch_id = public.current_user_branch()
    )
  );

create policy "super admin reads all certificates" on public.certificates
  for select to authenticated using (public.current_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- audit_log: super admin reads; nobody else sees it, nobody writes to it
-- directly. Rows arrive via the security definer trigger.
-- ---------------------------------------------------------------------------

create policy "super admin reads audit log" on public.audit_log
  for select to authenticated using (public.current_user_role() = 'super_admin');

-- number_sequences: no policies at all. Server side only, via
-- next_sequence_value(), which is security definer.
