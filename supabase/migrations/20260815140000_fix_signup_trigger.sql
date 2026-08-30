-- Repair registration.
--
-- The document types migration dropped public.state_bands, because fees do
-- not vary by state. handle_new_user was not updated with it, and still ran
--
--   select 1 from public.state_bands where state = v_state
--
-- against a table that no longer exists. Postgres raises "relation does not
-- exist" inside the trigger, which aborts the insert into auth.users, so
-- EVERY registration failed with a database error.
--
-- The lesson worth keeping: dropping a table is not finished until every
-- function body referencing it has been checked. plpgsql does not resolve
-- table names until the statement runs, so nothing failed at migration time.
--
-- practice_state is now free text validated in the app rather than against a
-- lookup table. Its foreign key was dropped with state_bands.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(upper(trim(meta ->> 'branch_code')), '');
  v_state text := nullif(trim(meta ->> 'practice_state'), '');
  v_branch_id uuid;
  v_role public.user_role := 'individual';
begin
  if v_code is not null then
    select id into v_branch_id from public.branches where branch_code = v_code;
    if v_branch_id is null then
      raise exception 'Unknown branch code %', v_code using errcode = 'P0001';
    end if;
    v_role := 'branch_member';
  end if;

  insert into public.profiles (id, full_name, email, phone, scn, branch_id, practice_state, role)
  values (
    new.id,
    coalesce(meta ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(trim(meta ->> 'phone'), ''),
    nullif(trim(meta ->> 'scn'), ''),
    v_branch_id,
    v_state,
    v_role
  );
  return new;
end;
$$;
