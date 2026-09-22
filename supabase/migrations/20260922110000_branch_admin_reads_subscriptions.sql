-- A branch administrator may read their own members' subscriptions.
--
-- Until now the policies on subscriptions admitted the owner and the super
-- administrator and nobody else, so a branch administrator could see neither
-- who in their branch was subscribed nor when a subscription lapsed.
--
-- That gap had a daily cost. create_transaction refuses a receipt without an
-- active subscription, and the practitioner who hits that refusal calls their
-- branch. The administrator taking the call could see the person, their
-- transactions and their certificates, but not the one fact that explains what
-- the practitioner is looking at. The practitioners screen said as much in its
-- own words: subscription state "is not shown", on the grounds that entitlement
-- comes from a payment webhook and there would be nothing for an administrator
-- to act on. That conflates acting with seeing. Nobody is being given a way to
-- grant a subscription here, only to read one.
--
-- Scoped to the administrator's own branch, through profiles rather than
-- through subscriptions itself, because subscriptions carries no branch column
-- and the practitioner's branch is what defines whose business this is.
--
-- The amount and plan come with it. Both are already visible to the
-- practitioner, and a branch fielding a billing question needs to see what was
-- bought, not merely that something was.

create policy "branch admin reads branch subscriptions" on public.subscriptions
  for select to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and exists (
      select 1 from public.profiles p
      where p.id = subscriptions.user_id
        and p.branch_id = public.current_user_branch()
    )
  );
