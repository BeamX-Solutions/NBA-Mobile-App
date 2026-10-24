/**
 * The practitioner, back from Paystack's checkout, asks whether it worked.
 *
 * POST { reference } with their session. Only the practitioner who started
 * the checkout may confirm it. The answer comes from Paystack's verify API,
 * never from the browser, so this activates the subscription even before the
 * webhook arrives, or if it never does. The webhook and this share one
 * idempotent path, so both arriving grants one subscription.
 */

import { createClient } from "npm:@supabase/supabase-js@2.117.1";

import { confirmPayment, corsHeaders, json, requireEnv } from "../_shared/paystack.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in to continue" }, 401);

  const body = await request.json().catch(() => null) as { reference?: unknown } | null;
  const reference = body?.reference;
  if (typeof reference !== "string" || reference.length === 0 || reference.length > 100) {
    return json({ error: "No payment reference was given" }, 400);
  }

  // RLS shows a practitioner their own checkouts only, so a reference that
  // is not theirs reads exactly like one that does not exist.
  const asUser = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: payment, error } = await asUser
    .from("subscription_payments")
    .select("status, subscription_id")
    .eq("reference", reference)
    .maybeSingle();
  if (error) return json({ error: error.message }, 400);
  if (payment === null) return json({ error: "That payment could not be found" }, 404);

  const service = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  try {
    const result = await confirmPayment(service, requireEnv("PAYSTACK_SECRET_KEY"), reference);
    return json(result.status === "unknown" ? { status: "failed" } : result);
  } catch (cause) {
    console.error(cause);
    return json({ error: "The payment could not be checked with Paystack. Please try again." }, 502);
  }
});
