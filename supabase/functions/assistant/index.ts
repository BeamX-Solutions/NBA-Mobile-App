/**
 * The personal assistant.
 *
 * POST { message } with the practitioner's session. Returns { reply }.
 *
 * The database decides whether they may ask (an active subscription and the
 * rate limit), records the message, and hands back the conversation
 * (assistant_begin_turn). Claude answers, calling tools that are database
 * functions run with the practitioner's own token, so each one sees only
 * their records. The reply is stored with assistant_finish_turn.
 *
 * This function never holds the service role key.
 */

import Anthropic from "npm:@anthropic-ai/sdk@1.1.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.1";

import {
  conversationFor,
  databaseCallFor,
  DEFAULT_MODEL,
  lagosToday,
  MAX_TOOL_ROUNDS,
  type StoredMessage,
  statusForDatabaseError,
  SYSTEM_PROMPT,
  ToolInputError,
  TOOLS,
} from "../_shared/assistant.ts";
import { corsHeaders, json, requireEnv } from "../_shared/paystack.ts";

const FALLBACK_CAPABLE = /^claude-(opus|sonnet|fable)-/;

const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

async function runTool(asUser: SupabaseClient, block: Anthropic.Beta.BetaToolUseBlock) {
  try {
    const call = databaseCallFor(block.name, block.input);
    const { data, error } = await asUser.rpc(call.fn, call.args);
    if (error) {
      console.error(block.name, error);
      return { type: "tool_result" as const, tool_use_id: block.id, content: error.message, is_error: true };
    }
    return { type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify(data) };
  } catch (cause) {
    if (cause instanceof ToolInputError) {
      return { type: "tool_result" as const, tool_use_id: block.id, content: cause.message, is_error: true };
    }
    throw cause;
  }
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function answer(asUser: SupabaseClient, history: StoredMessage[]): Promise<string> {
  const model = Deno.env.get("ASSISTANT_MODEL") ?? DEFAULT_MODEL;
  const messages: Anthropic.Beta.BetaMessageParam[] = conversationFor(history, lagosToday());
  const fallback = FALLBACK_CAPABLE.test(model);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 4096,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      // The last round offers no tools, so the model has to answer.
      ...(round === MAX_TOOL_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
      messages,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    });

    if (response.stop_reason === "refusal") {
      return "I can't help with that one. I can answer questions about your invoices, certificates, payments, subscription and fees.";
    }

    if (response.stop_reason !== "tool_use") {
      return textOf(response.content) || "Sorry, I couldn't put an answer together. Please try asking again.";
    }

    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    // All results in one message, so parallel calls stay parallel.
    const results = await Promise.all(toolUses.map((block) => runTool(asUser, block)));
    messages.push({ role: "user", content: results });
  }

  return "Sorry, that took too many steps. Please try a narrower question.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in to use the assistant." }, 401);

  const body = await request.json().catch(() => null) as { message?: unknown } | null;
  if (typeof body?.message !== "string") return json({ error: "Type a question first." }, 400);

  // As the practitioner: entitlement, the rate limit and every tool act for
  // auth.uid() and see only what row level security lets them see.
  const asUser = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: turn, error: turnError } = await asUser.rpc("assistant_begin_turn", { p_message: body.message });
  if (turnError) {
    // The database's own messages are written for the practitioner.
    return json({ error: turnError.message }, statusForDatabaseError(turnError.code));
  }

  const { message_id: messageId, history } = turn as { message_id: string; history: StoredMessage[] };

  let reply: string;
  try {
    reply = await answer(asUser, history);
  } catch (cause) {
    console.error(cause);
    const status = cause instanceof Anthropic.RateLimitError ? 503 : 502;
    return json({ error: "The assistant is unavailable right now. Please try again shortly." }, status);
  }

  const { error: finishError } = await asUser.rpc("assistant_finish_turn", {
    p_message_id: messageId,
    p_reply: reply,
  });
  if (finishError) console.error(finishError);

  return json({ reply, messageId });
});
