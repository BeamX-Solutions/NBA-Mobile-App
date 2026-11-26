-- The first month free: the rate type that marks it.
--
-- On its own because Postgres will not let a transaction use an enum value it
-- added. 20261126100100_first_month_free.sql uses it.

alter type public.subscription_rate_type add value if not exists 'free_trial';
