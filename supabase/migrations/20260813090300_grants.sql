-- Phase 1: explicit table-level privileges.
--
-- RLS decides which ROWS a caller may see; GRANT decides whether the caller
-- may touch the TABLE at all. Both must line up. Supabase's default
-- privileges usually grant the client roles access to new tables in public,
-- but relying on that makes the schema depend on project configuration that
-- is not in this repository: if it is absent, every query fails with
-- "permission denied for table" instead of the intended RLS behaviour.
-- Granting explicitly keeps the migrations self-contained and makes the
-- privilege surface reviewable in one place.
--
-- These grants are deliberately no wider than the policies in
-- 20260813090200_rls_policies.sql. A table with no policy for a given
-- operation stays unreachable for that operation even where granted,
-- because RLS denies by default.

grant usage on schema public to anon, authenticated, service_role;

-- Reference data: readable by everyone, including signed-out clients, so the
-- calculator can cache the active scale for offline use.
grant select on public.state_bands to anon, authenticated;
grant select on public.fee_scales to anon, authenticated;
grant select on public.fee_scale_bands to anon, authenticated;

-- Super admin manages reference data through the policies on these tables.
grant insert, update, delete on public.state_bands to authenticated;
grant insert, update, delete on public.fee_scales to authenticated;
grant insert, update, delete on public.fee_scale_bands to authenticated;

-- Branches: any signed-in user reads (receipts show branch bank details);
-- branch admins update their own, super admin creates.
grant select, insert, update on public.branches to authenticated;

-- Profiles: own row, plus branch admin and super admin visibility.
-- No delete: profiles are removed only by deleting the auth user.
grant select, update on public.profiles to authenticated;

-- Subscriptions and certificates are read-only to clients. Every write is
-- server side (Paystack webhook, certificate issuance), so no insert,
-- update or delete is granted here at all.
grant select on public.subscriptions to authenticated;
grant select on public.certificates to authenticated;

-- Calculations: free tier, owner creates and reads.
grant select, insert on public.calculations to authenticated;

-- Transactions: owner creates and submits, branch admin verifies.
-- No delete: transactions are permanent records.
grant select, insert, update on public.transactions to authenticated;

-- Audit log: super admin reads via policy. Nothing may write to it directly;
-- rows arrive only through the security definer trigger.
grant select on public.audit_log to authenticated;

-- number_sequences is intentionally omitted: no grants, no policies. It is
-- reachable only through next_sequence_value(), which is security definer.

-- The service role bypasses RLS but still needs table privileges.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
