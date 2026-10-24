/**
 * Paystack's webhook.
 *
 * Deployed without JWT verification (config.toml): Paystack has no Supabase
 * session. It proves itself instead with x-paystack-signature, checked over
 * the raw body before anything is parsed. An unsigned or mis-signed request
 * changes nothing.
 *
 * Even a signed charge.success is not taken at its word: the reference is
 * verified with Paystack's API and recorded through the same path as the
 * practitioner's confirm call.
 *
 * Replies 200 to anything signed that was handled, including references this
 * database never issued (another product on the same Paystack account), so
 * Paystack does not retry them. A 500 means something failed here and a retry
 * is wanted.
 */

import { createClient } from "npm:@supabase/supabase-js@2.117.1";

import { confirmPayment, json, requireEnv, signatureIsValid } from "../_shared/paystack.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  const secret = requireEnv("PAYSTACK_SECRET_KEY");
  const rawBody = await request.text();
  if (!(await signatureIsValid(rawBody, request.headers.get("x-paystack-signature"), secret))) {
    return json({ error: "Bad signature" }, 401);
  }

  let event: { event?: unknown; data?: { reference?: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Body is not JSON" }, 400);
  }

  const reference = event.data?.reference;
  if (event.event !== "charge.success" || typeof reference !== "string") {
    return json({ received: true });
  }

  const service = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  try {
    const result = await confirmPayment(service, secret, reference);
    return json({ received: true, status: result.status });
  } catch (cause) {
    console.error(cause);
    return json({ error: "Could not record the payment" }, 500);
  }
});
