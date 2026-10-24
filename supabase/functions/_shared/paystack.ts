/**
 * Paystack, as the subscription functions use it.
 *
 * The rules about money live in the database (migration 20261025100000):
 * what a plan costs, who may buy, and what a confirmed payment grants. This
 * file only talks to Paystack and decides what Paystack's answer means.
 *
 * Nothing a browser says about a payment is believed. A subscription follows
 * only from Paystack's own verify API, for a reference the database issued, in
 * naira, for the amount the database priced. record_subscription_payment
 * checks the amount again, so a mistake here grants nothing either.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.1";

const PAYSTACK_API = "https://api.paystack.co";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

/**
 * Paystack signs the raw request body with HMAC-SHA512 under the secret key
 * and sends the hex digest as x-paystack-signature. Compared in constant time
 * so the comparison leaks nothing about how close a forgery came.
 */
export async function signatureIsValid(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, signature.trim().toLowerCase());
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Where Paystack sends the practitioner back to
// ---------------------------------------------------------------------------

/**
 * The callback URL comes from the caller, so it is accepted only on an origin
 * in ALLOWED_CALLBACK_ORIGINS. Otherwise the checkout would hand Paystack's
 * trusted redirect to any site that asked.
 */
export function allowedCallback(candidate: unknown, allowList: string): string | null {
  if (typeof candidate !== "string") return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const origins = allowList.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  return origins.includes(url.origin) ? url.toString() : null;
}

export const DEFAULT_CALLBACK_ORIGINS = "https://nbacalculator.app,http://localhost:3000";

// ---------------------------------------------------------------------------
// Paystack's API
// ---------------------------------------------------------------------------

export interface VerifiedCharge {
  reference: string;
  /** success, failed, abandoned, ongoing, pending, reversed, ... */
  status: string;
  /** Kobo. */
  amount: number;
  currency: string;
  paidAt: string | null;
}

/** What a verify response means for the subscription. */
export type ChargeOutcome = "paid" | "failed" | "pending";

export function outcomeOf(charge: VerifiedCharge): ChargeOutcome {
  if (charge.status === "success" && charge.currency === "NGN") return "paid";
  // A success in another currency is not a naira payment for a naira price.
  if (charge.status === "success" || charge.status === "failed" || charge.status === "reversed") {
    return "failed";
  }
  // abandoned, ongoing, pending, processing, queued: the practitioner may yet
  // pay under this reference.
  return "pending";
}

/** Reads Paystack's verify response, refusing anything not shaped as expected. */
export function parseVerifyResponse(body: unknown, reference: string): VerifiedCharge {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") throw new Error("Paystack returned no transaction");
  const { status, amount, currency, paid_at } = data;
  if (data.reference !== reference) throw new Error("Paystack answered for a different reference");
  if (typeof status !== "string" || typeof amount !== "number" || typeof currency !== "string") {
    throw new Error("Paystack returned a transaction in an unexpected shape");
  }
  return {
    reference,
    status,
    amount,
    currency,
    paidAt: typeof paid_at === "string" ? paid_at : null,
  };
}

async function paystack(path: string, secret: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || (body as { status?: boolean } | null)?.status !== true) {
    const message = (body as { message?: string } | null)?.message ?? response.statusText;
    throw new Error(`Paystack ${path.split("?")[0]} failed: ${message}`);
  }
  return body;
}

export async function initializeCharge(
  secret: string,
  charge: { email: string; amount: number; reference: string; callbackUrl: string | null; plan: string },
): Promise<string> {
  const body = await paystack("/transaction/initialize", secret, {
    method: "POST",
    body: JSON.stringify({
      email: charge.email,
      amount: charge.amount,
      currency: "NGN",
      reference: charge.reference,
      ...(charge.callbackUrl === null ? {} : { callback_url: charge.callbackUrl }),
      // For the Paystack dashboard only. Nothing reads it back.
      metadata: { plan: charge.plan },
    }),
  });
  const url = (body as { data?: { authorization_url?: unknown } }).data?.authorization_url;
  if (typeof url !== "string") throw new Error("Paystack returned no checkout address");
  return url;
}

export async function verifyCharge(secret: string, reference: string): Promise<VerifiedCharge> {
  const body = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`, secret);
  return parseVerifyResponse(body, reference);
}

// ---------------------------------------------------------------------------
// The one path from a Paystack payment to a subscription
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { status: "active"; expiresAt: string }
  | { status: "pending" }
  | { status: "failed" }
  /** Not a reference this database issued: another product on the account. */
  | { status: "unknown" };

/**
 * Asks Paystack about a reference and records what it says. Used by both the
 * webhook and the practitioner's confirm call; record_subscription_payment is
 * idempotent, so the two racing grant one subscription.
 */
export async function confirmPayment(
  service: SupabaseClient,
  secret: string,
  reference: string,
): Promise<ConfirmResult> {
  // A reference this database did not issue is somebody else's on the same
  // Paystack account, and one already paid needs no second look.
  const { data: payment, error: lookupError } = await service
    .from("subscription_payments")
    .select("status, subscriptions(expires_at)")
    .eq("reference", reference)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (payment === null) return { status: "unknown" };
  // One subscription per payment; PostgREST may still hand it back as a list.
  const embedded = (payment as unknown as { subscriptions: unknown }).subscriptions;
  const granted = (Array.isArray(embedded) ? embedded[0] : embedded) as { expires_at?: unknown } | null | undefined;
  if (payment.status === "paid" && typeof granted?.expires_at === "string") {
    return { status: "active", expiresAt: granted.expires_at };
  }

  const charge = await verifyCharge(secret, reference);
  const outcome = outcomeOf(charge);

  if (outcome === "pending") return { status: "pending" };

  if (outcome === "failed") {
    const { error } = await service.rpc("fail_subscription_payment", { p_reference: reference });
    if (error) throw new Error(error.message);
    return { status: "failed" };
  }

  const { data, error } = await service.rpc("record_subscription_payment", {
    p_reference: reference,
    p_amount: charge.amount,
    p_paid_at: charge.paidAt,
  });
  if (error) {
    if (error.code === "P0002") return { status: "unknown" };
    // Paid, but not the price this database set. Grants nothing; logged so
    // somebody can refund it.
    if (error.code === "22023") {
      console.error(`Payment ${reference} refused: ${error.message}`);
      return { status: "failed" };
    }
    throw new Error(error.message);
  }
  return { status: "active", expiresAt: (data as { expires_at: string }).expires_at };
}
