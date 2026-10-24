import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";

import {
  allowedCallback,
  DEFAULT_CALLBACK_ORIGINS,
  outcomeOf,
  parseVerifyResponse,
  signatureIsValid,
  type VerifiedCharge,
} from "./paystack.ts";

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const body = JSON.stringify({ event: "charge.success", data: { reference: "NBA-1" } });

Deno.test("a body signed with the secret is accepted", async () => {
  assertEquals(await signatureIsValid(body, await sign(body, "sk_test_x"), "sk_test_x"), true);
});

Deno.test("a body signed with another key is refused", async () => {
  assertEquals(await signatureIsValid(body, await sign(body, "sk_test_other"), "sk_test_x"), false);
});

Deno.test("a body altered after signing is refused", async () => {
  const signature = await sign(body, "sk_test_x");
  assertEquals(await signatureIsValid(body.replace("NBA-1", "NBA-2"), signature, "sk_test_x"), false);
});

Deno.test("no signature is refused", async () => {
  assertEquals(await signatureIsValid(body, null, "sk_test_x"), false);
  assertEquals(await signatureIsValid(body, "", "sk_test_x"), false);
});

Deno.test("callbacks are accepted on allow-listed origins only", () => {
  assertEquals(
    allowedCallback("https://nbacalculator.app/profile/plans/confirm", DEFAULT_CALLBACK_ORIGINS),
    "https://nbacalculator.app/profile/plans/confirm",
  );
  assertEquals(allowedCallback("http://localhost:3000/x", DEFAULT_CALLBACK_ORIGINS), "http://localhost:3000/x");
  assertEquals(allowedCallback("https://nbacalculator.app.evil.example/x", DEFAULT_CALLBACK_ORIGINS), null);
  assertEquals(allowedCallback("http://nbacalculator.app/x", DEFAULT_CALLBACK_ORIGINS), null);
  assertEquals(allowedCallback("javascript:alert(1)", DEFAULT_CALLBACK_ORIGINS), null);
  assertEquals(allowedCallback(42, DEFAULT_CALLBACK_ORIGINS), null);
});

const charge = (status: string, currency = "NGN"): VerifiedCharge => ({
  reference: "NBA-1",
  status,
  amount: 8500000,
  currency,
  paidAt: null,
});

Deno.test("only a naira success counts as paid", () => {
  assertEquals(outcomeOf(charge("success")), "paid");
  assertEquals(outcomeOf(charge("success", "USD")), "failed");
  assertEquals(outcomeOf(charge("failed")), "failed");
  assertEquals(outcomeOf(charge("reversed")), "failed");
  assertEquals(outcomeOf(charge("abandoned")), "pending");
  assertEquals(outcomeOf(charge("ongoing")), "pending");
});

Deno.test("a verify response is read only for the reference asked about", () => {
  const response = {
    status: true,
    data: { reference: "NBA-1", status: "success", amount: 8500000, currency: "NGN", paid_at: "2026-10-25T10:00:00Z" },
  };
  assertEquals(parseVerifyResponse(response, "NBA-1"), {
    reference: "NBA-1",
    status: "success",
    amount: 8500000,
    currency: "NGN",
    paidAt: "2026-10-25T10:00:00Z",
  });
  assertThrows(() => parseVerifyResponse(response, "NBA-2"));
  assertThrows(() => parseVerifyResponse({ status: true, data: { reference: "NBA-1", amount: "8500000" } }, "NBA-1"));
  assertThrows(() => parseVerifyResponse(null, "NBA-1"));
});
