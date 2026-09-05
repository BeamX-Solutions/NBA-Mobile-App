# Auth emails

Supabase sends these, so they live in the project's dashboard rather than in
this repository. They are kept here because a template that exists only in a
dashboard is a template nobody reviews, and because losing the project would
otherwise lose them.

| File | Dashboard location |
|---|---|
| [`confirm-signup.html`](confirm-signup.html) | Authentication → Emails → Confirm signup |
| [`reset-password.html`](reset-password.html) | Authentication → Emails → Reset Password |

Paste the file contents in and save. `{{ .ConfirmationURL }}` is substituted by
Supabase at send time; leave it exactly as written.

They are built as tables with inline styles because email clients are not
browsers. Outlook renders through Word, some Gmail contexts strip `<style>`
blocks, and neither flexbox nor grid can be relied on. No web fonts either: a
named stack degrades to the reader's system face rather than silently landing
on Times at the wrong size. The seal is loaded from the deployed console rather
than embedded, because a base64 image in the body pushes many clients into
clipping the message.

## The state of email on this project, as of 5 September 2026

**Nothing can reliably be sent.** The project uses Supabase's built-in sender,
which exists for development: it rate limits after a couple of messages an hour
and is not meant to carry real traffic.

**Email confirmation is switched off.** That is why registration works today. It
also means nobody proves they own the address they register with, and the
address a Certificate of Compliance would be sent to is unverified.

**Password reset does not work.** The Forgot Password screen calls
`auth/v1/recover`, which has to actually send. Against `@nbaanaocha.org` it is
refused outright with `email_address_invalid`, because that domain cannot
receive mail; against a real address it would meet the rate limit instead. A
practitioner who forgets their password currently has no way back into their
account.

That last point is the one that bites first, and it is invisible until someone
tries it.

## What has to happen

1. **Get a sending domain.** Certificates carry a QR code pointing at a host,
   and emails should come from the same identity. A `vercel.app` subdomain
   cannot send mail, so this arrives at the same conclusion as the verification
   host: the branch needs a domain it controls.

2. **Create an account with a transactional provider.** Resend, Postmark and
   SendGrid all have free tiers that comfortably cover a branch. Verify the
   domain there, which means adding the SPF and DKIM records they give you.
   Skipping that step is how mail lands in spam.

3. **Put the SMTP credentials into Supabase**, under Project Settings →
   Authentication → SMTP Settings: host, port, username, password, sender
   address and sender name. Then raise the rate limit under Auth → Rate Limits,
   which stays at the development default until changed.

4. **Send one real reset to a real inbox** before believing any of it. The
   failure mode is silence, not an error.

5. **Turn email confirmation back on**, once sending works.

## Still not built

The brief (§7) requires the Certificate of Compliance to be emailed
automatically on issue. Nothing does that: `certificates.emailed_at` is never
set. It needs the same provider as everything above, plus a server-side sender,
since the certificate is currently rendered on the device and no backend exists
to attach it.
