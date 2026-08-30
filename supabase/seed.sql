-- Development fixtures. Applied by `supabase db reset` locally only.
--
-- Reference data (the State Band mapping and the active fee scale) is NOT
-- here: it lives in migrations, because every environment needs it and
-- changes to it should be auditable. See
-- supabase/migrations/20260813090400_reference_data.sql.
--
-- What remains below is a dev-only branch so there is a branch code to
-- register against. Do not apply this to production: activation data is
-- placeholder and the bank details are not real.

insert into public.branches (
  name, branch_code, activation_status, activated_at, expires_at,
  account_name, account_number, bank_name, chairman_name
)
values (
  'NBA Anaocha Branch', 'ANAOCHA', 'active', now(), now() + interval '1 year',
  'NBA Anaocha Branch', '0000000000', 'Dev Bank', 'Dev Chairman'
)
on conflict (branch_code) do nothing;
