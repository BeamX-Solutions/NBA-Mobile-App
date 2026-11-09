/**
 * The personal assistant's tools and instructions.
 *
 * Every tool is a database function that runs as the practitioner and
 * filters on their own user_id (migration 20261109100000). This module only
 * describes the tools to the model, checks what the model asks for, and turns
 * a request into the database call. Nothing here reads data itself.
 */

import type Anthropic from "npm:@anthropic-ai/sdk@1.1.0";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Tool rounds allowed in one reply before the assistant must answer. */
export const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `You are the NBA Calculator assistant. You help one Nigerian legal practitioner with their own work in the app: their invoices, proofs of payment, certificates of compliance, payments from their branch, their subscription, and the fees the Legal Practitioners Remuneration Order 2023 prescribes for their documents.

Everything you know about the practitioner comes from your tools, and the tools only ever return the practitioner's own records. Use them for any question about their work; never answer from memory or guess a status, an amount, an invoice number or an RBIN. If a tool returns nothing, say you could not find it.

How the app works:
- The practitioner calculates a fee, then generates an invoice (TXN-00001-DOA style). Their client pays the amount payable into the branch's account.
- The practitioner uploads proof of that payment. Until then the invoice is awaiting payment.
- The branch verifies the proof. On verification it issues an RBIN and a Certificate of Compliance. A rejected proof carries the branch's reason, and the practitioner can upload a new proof.
- The branch keeps its branch fee and pays the rest to the practitioner, recorded as a payout.
- Fees under Scale 4 are minimums. Say "prescribed minimum", never "the fee".

Rules:
- Only discuss the practitioner's own records, their subscription, and how the Remuneration Order applies to their fees. Politely decline anything else, including legal advice on a matter, other people's records, and general questions unrelated to the app.
- Amounts arrive already written in naira. Quote them as given; do not add, convert or round them yourself. For a total, use a tool that returns one.
- When you mention a transaction or certificate, include its link from the tool result as a markdown link, for example [TXN-00012-DOA](/transactions/...), so the practitioner can open it.
- Be brief and plain. Use short lists for several items. Do not use em dashes.`;

const STATUSES = ["awaiting_payment", "pending_verification", "verified", "rejected"] as const;

const DOCUMENT_TYPES = [
  "deed_of_assignment",
  "deed_of_conveyance",
  "deed_of_gift",
  "contract_of_sale",
  "deed_of_surrender",
  "deed_of_exchange",
  "mortgage_deed",
  "deed_of_release",
  "tenancy_agreement",
  "deed_of_lease",
  "deed_of_sub_lease",
  "power_of_attorney",
] as const;

const date = { type: "string", description: "A date, YYYY-MM-DD." };

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "pending_items",
    description:
      "Everything that needs the practitioner's attention: invoices awaiting proof of payment, proofs waiting for the branch, rejected proofs with reasons, verified work whose share the branch has not yet paid, membership still under review, and a subscription ending within 7 days. Use for 'what is pending', 'what do I need to do', and similar.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_transactions",
    description:
      "The practitioner's invoices, newest first, at most 25, with a total count. All filters are optional. Dates filter on the day the invoice was generated.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...STATUSES] },
        from: date,
        to: date,
        document_type: { type: "string", enum: [...DOCUMENT_TYPES] },
        search: { type: "string", description: "Text to find in the parties or the property description." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_transaction",
    description:
      "One of the practitioner's transactions in full, including its certificate if issued. Takes the transaction id, invoice number (TXN-00012-DOA) or RBIN.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
      additionalProperties: false,
    },
  },
  {
    name: "list_certificates",
    description: "The practitioner's certificates of compliance, newest first, including revoked ones unless asked not to.",
    input_schema: {
      type: "object",
      properties: { include_revoked: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "spend_summary",
    description:
      "Totals for invoices generated between two dates: counts by status and by document, and for verified invoices the amount paid into the branch, branch fees, and the amount due to the practitioner.",
    input_schema: {
      type: "object",
      properties: { from: date, to: date },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "payouts_received",
    description: "Payments the branch has made to the practitioner, newest first, with the invoices each settled and a total. Dates are optional.",
    input_schema: {
      type: "object",
      properties: { from: date, to: date },
      additionalProperties: false,
    },
  },
  {
    name: "subscription_status",
    description: "The practitioner's current or most recent subscription: plan, status, dates, and whether renewal is open.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "quote_fee",
    description:
      "The prescribed minimum fee under Scale 4 for a document and consideration (annual rent for leases and tenancies), with the branch fee and what the practitioner keeps. Calculated by the app's own fee engine.",
    input_schema: {
      type: "object",
      properties: {
        document_type: { type: "string", enum: [...DOCUMENT_TYPES] },
        consideration_naira: { type: "number", description: "The consideration in naira, for example 25000000 for ₦25m." },
      },
      required: ["document_type", "consideration_naira"],
      additionalProperties: false,
    },
  },
];

export interface DatabaseCall {
  fn: string;
  args: Record<string, unknown>;
}

export class ToolInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function input(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function optionalDate(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ToolInputError(`${name} must be a date written YYYY-MM-DD`);
  }
  return value;
}

function requiredDate(value: unknown, name: string): string {
  const parsed = optionalDate(value, name);
  if (parsed === null) throw new ToolInputError(`${name} is required`);
  return parsed;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ToolInputError(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ToolInputError(`${name} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ToolInputError(`${name} is too long`);
  return trimmed === "" ? null : trimmed;
}

/**
 * Turns the model's tool request into a database function call, or throws a
 * ToolInputError the model can read and correct.
 */
export function databaseCallFor(name: string, raw: unknown): DatabaseCall {
  const given = input(raw);
  switch (name) {
    case "pending_items":
      return { fn: "assistant_pending_items", args: {} };
    case "list_transactions":
      return {
        fn: "assistant_list_transactions",
        args: {
          p_status: optionalEnum(given.status, STATUSES, "status"),
          p_from: optionalDate(given.from, "from"),
          p_to: optionalDate(given.to, "to"),
          p_document_type: optionalEnum(given.document_type, DOCUMENT_TYPES, "document_type"),
          p_search: optionalText(given.search, "search", 100),
        },
      };
    case "get_transaction": {
      const reference = optionalText(given.reference, "reference", 100);
      if (reference === null) throw new ToolInputError("reference is required");
      return { fn: "assistant_get_transaction", args: { p_reference: reference } };
    }
    case "list_certificates":
      return {
        fn: "assistant_list_certificates",
        args: { p_include_revoked: given.include_revoked !== false },
      };
    case "spend_summary": {
      const from = requiredDate(given.from, "from");
      const to = requiredDate(given.to, "to");
      if (from > to) throw new ToolInputError("from must not be after to");
      return { fn: "assistant_spend_summary", args: { p_from: from, p_to: to } };
    }
    case "payouts_received":
      return {
        fn: "assistant_payouts",
        args: { p_from: optionalDate(given.from, "from"), p_to: optionalDate(given.to, "to") },
      };
    case "subscription_status":
      return { fn: "assistant_subscription", args: {} };
    case "quote_fee": {
      const documentType = optionalEnum(given.document_type, DOCUMENT_TYPES, "document_type");
      if (documentType === null) throw new ToolInputError("document_type is required");
      const naira = given.consideration_naira;
      if (typeof naira !== "number" || !Number.isFinite(naira) || naira < 0) {
        throw new ToolInputError("consideration_naira must be a number of naira, not negative");
      }
      return {
        fn: "assistant_quote_fee",
        args: { p_document_type: documentType, p_consideration_kobo: Math.round(naira * 100) },
      };
    }
    default:
      throw new ToolInputError(`There is no tool called ${name}`);
  }
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The stored conversation as model messages. It must open with the
 * practitioner, so a reply cut loose by the history window is dropped. The
 * date goes on the newest message, never the system prompt, which stays
 * byte-identical so it caches.
 */
export function conversationFor(history: StoredMessage[], today: string): Anthropic.MessageParam[] {
  const start = history.findIndex((message) => message.role === "user");
  if (start === -1) return [];
  const messages: Anthropic.MessageParam[] = history.slice(start).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const last = messages[messages.length - 1];
  if (last.role === "user" && typeof last.content === "string") {
    last.content = [
      { type: "text", text: `Today is ${today} in Lagos.` },
      { type: "text", text: last.content },
    ];
  }
  return messages;
}

/** Today's date in Lagos, YYYY-MM-DD. */
export function lagosToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

/** Maps the database's PT-prefixed codes to HTTP statuses for the app. */
export function statusForDatabaseError(code: string | undefined): number {
  if (code && /^PT\d{3}$/.test(code)) return Number(code.slice(2));
  if (code === "42501") return 401;
  if (code === "22023") return 400;
  return 500;
}
