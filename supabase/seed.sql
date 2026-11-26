-- Development fixtures. Applied by `supabase db reset` locally only.
--
-- Reference data (the State Band mapping and the active fee scale) is NOT
-- here: it lives in migrations, because every environment needs it and
-- changes to it should be auditable. See
-- supabase/migrations/20260813090400_reference_data.sql.
--
-- What remains below makes one branch usable, so there is a branch to
-- register against. The branch directory (also a migration) already lists
-- every branch, Anaocha included, as inactive; this activates it with
-- placeholder bank details. Do not apply this to production: the activation
-- is for development and the bank details are not real.

update public.branches
set activation_status = 'active',
    activated_at = coalesce(activated_at, now()),
    account_name = 'NBA Anaocha Branch',
    account_number = '0000000000',
    bank_name = 'Dev Bank',
    chairman_name = 'Dev Chairman'
where branch_code = 'ANAOCHA';
