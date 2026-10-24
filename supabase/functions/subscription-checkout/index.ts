/**
 * Starts a Paystack checkout for a subscription.
 *
 * POST { plan, callbackUrl } with the practitioner's session. The database
 * decides whether they may buy and what it costs (begin_subscription_payment),
 * and records the checkout before Paystack hears of it. Returns the address
 * of Paystack's checkout page and the reference to confirm afterwards.
 */

import { createClient } from "npm:@supabase/supabase-js@2.117.1";

import {
  allowedCallback,
  corsHeaders,
  DEFAULT_CALLBACK_ORIGINS,
  initializeCharge,
  json,
  requireEnv,
} from "../_shared/paystack.ts";

const PLANS = new Set(["monthly", "quarterly", "yearly"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in to subscribe" }, 401);

  const body = await request.json().catch(() => null) as { plan?: unknown; callbackUrl?: unknown } | null;
  const plan = body?.plan;
  if (typeof plan !== "string" || !PLANS.has(plan)) return json({ error: "Choose a plan" }, 400);

  const callbackUrl = allowedCallback(
    body?.callbackUrl,
    Deno.env.get("ALLOWED_CALLBACK_ORIGINS") ?? DEFAULT_CALLBACK_ORIGINS,
  );

  // As the practitioner, so begin_subscription_payment acts for auth.uid().
  const asUser = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await asUser.rpc("begin_subscription_payment", { p_plan: plan });
  if (error) {
    // The database's own messages are written for the practitioner.
    const status = error.code === "42501" ? 403 : 400;
    return json({ error: error.message }, status);
  }

  const checkout = data as { reference: string; amount: number; email: string };
  try {
    const authorizationUrl = await initializeCharge(requireEnv("PAYSTACK_SECRET_KEY"), {
      email: checkout.email,
      amount: checkout.amount,
      reference: checkout.reference,
      callbackUrl,
      plan,
    });
    return json({ authorizationUrl, reference: checkout.reference });
  } catch (cause) {
    console.error(cause);
    return json({ error: "Paystack could not start the payment. Please try again." }, 502);
  }
});
