import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";

import {
  conversationFor,
  databaseCallFor,
  lagosToday,
  statusForDatabaseError,
  ToolInputError,
  TOOLS,
} from "./assistant.ts";

Deno.test("every tool the model is offered has a database call", () => {
  const minimal: Record<string, unknown> = {
    get_transaction: { reference: "TXN-00001-DOA" },
    spend_summary: { from: "2026-10-01", to: "2026-10-31" },
    quote_fee: { document_type: "deed_of_assignment", consideration_naira: 1 },
  };
  for (const tool of TOOLS) {
    const call = databaseCallFor(tool.name, minimal[tool.name] ?? {});
    assertEquals(call.fn.startsWith("assistant_"), true, tool.name);
  }
});

Deno.test("an unknown tool is refused", () => {
  assertThrows(() => databaseCallFor("delete_everything", {}), ToolInputError);
});

Deno.test("list_transactions passes filters and nulls what is left out", () => {
  assertEquals(databaseCallFor("list_transactions", { status: "rejected", search: "  Okafor " }), {
    fn: "assistant_list_transactions",
    args: { p_status: "rejected", p_from: null, p_to: null, p_document_type: null, p_search: "Okafor" },
  });
});

Deno.test("list_transactions refuses a status the database does not have", () => {
  assertThrows(() => databaseCallFor("list_transactions", { status: "paid" }), ToolInputError);
});

Deno.test("dates must be YYYY-MM-DD", () => {
  assertThrows(() => databaseCallFor("payouts_received", { from: "1 October" }), ToolInputError);
  assertThrows(() => databaseCallFor("spend_summary", { from: "2026-10-01" }), ToolInputError);
  assertThrows(
    () => databaseCallFor("spend_summary", { from: "2026-11-01", to: "2026-10-01" }),
    ToolInputError,
  );
});

Deno.test("get_transaction needs a reference", () => {
  assertThrows(() => databaseCallFor("get_transaction", { reference: "  " }), ToolInputError);
});

Deno.test("list_certificates includes revoked ones unless told not to", () => {
  assertEquals(databaseCallFor("list_certificates", {}).args, { p_include_revoked: true });
  assertEquals(databaseCallFor("list_certificates", { include_revoked: false }).args, { p_include_revoked: false });
});

Deno.test("quote_fee turns naira into whole kobo", () => {
  assertEquals(databaseCallFor("quote_fee", { document_type: "mortgage_deed", consideration_naira: 25_000_000.5 }), {
    fn: "assistant_quote_fee",
    args: { p_document_type: "mortgage_deed", p_consideration_kobo: 2_500_000_050 },
  });
  assertThrows(
    () => databaseCallFor("quote_fee", { document_type: "mortgage_deed", consideration_naira: -1 }),
    ToolInputError,
  );
  assertThrows(
    () => databaseCallFor("quote_fee", { document_type: "will", consideration_naira: 1 }),
    ToolInputError,
  );
});

Deno.test("the conversation opens with the practitioner and dates the newest message", () => {
  const messages = conversationFor([
    { role: "assistant", content: "An orphaned reply" },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "What is pending for me?" },
  ], "2026-11-09");

  assertEquals(messages.length, 3);
  assertEquals(messages[0], { role: "user", content: "Earlier question" });
  assertEquals(messages[2].content, [
    { type: "text", text: "Today is 2026-11-09 in Lagos." },
    { type: "text", text: "What is pending for me?" },
  ]);
});

Deno.test("an empty history gives no conversation", () => {
  assertEquals(conversationFor([], "2026-11-09"), []);
});

Deno.test("Lagos is an hour ahead of UTC", () => {
  assertEquals(lagosToday(new Date("2026-11-09T23:30:00Z")), "2026-11-10");
});

Deno.test("database codes become HTTP statuses", () => {
  assertEquals(statusForDatabaseError("PT402"), 402);
  assertEquals(statusForDatabaseError("PT429"), 429);
  assertEquals(statusForDatabaseError("42501"), 401);
  assertEquals(statusForDatabaseError("22023"), 400);
  assertEquals(statusForDatabaseError("XX000"), 500);
  assertEquals(statusForDatabaseError(undefined), 500);
});
