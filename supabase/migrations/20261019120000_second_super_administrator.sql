-- A second super administrator: Uzoma Charles Dioha.
--
-- Client request, 19 October 2026. Done here because the console deliberately
-- offers no route to super_admin (set_user_role refuses it): an interface that
-- can mint platform administrators is one that can be used to mint one.
--
-- He was an approved member of NBA Anaocha Branch, and its chairman. As a
-- super administrator he belongs to no branch, as in 20260922120000, so he
-- no longer practises through the apps. His transactions and certificates
-- keep their branch and stay valid; Anaocha's administrators still record
-- remittance on them. The chairman's name and signature on the branch record
-- are separate and untouched.
--
-- Matched by email, and refused unless it finds exactly the account expected,
-- so an ambiguous or changed account changes nothing rather than something
-- else. A database without the account at all (a local reset) skips it.

do $$
declare
  v_matches int;
  v_id uuid;
begin
  select count(*), min(id::text)::uuid into v_matches, v_id
  from public.profiles
  where lower(email) = 'legalpracticeonline@gmail.com';

  if v_matches = 0 then
    raise notice 'No profile for legalpracticeonline@gmail.com here; nothing to promote';
    return;
  end if;

  if v_matches > 1 then
    raise exception 'Expected one profile for legalpracticeonline@gmail.com, found %', v_matches;
  end if;

  if (select role from public.profiles where id = v_id) <> 'branch_member' then
    raise exception 'legalpracticeonline@gmail.com is no longer a branch_member; refusing to promote';
  end if;

  update public.profiles
  set role = 'super_admin',
      branch_id = null,
      practice_state = null
  where id = v_id;
end;
$$;
