// Collects one milestone through a PROCESSOR rail (today: Stripe).
//
// Only for rails where money is collected in-app. A check, Zelle, Venmo or wire is
// recorded afterwards through the record_manual_payment RPC - no edge function needed -
// and this one refuses those rails rather than pretending to handle them.
//
// NON-CUSTODIAL: a DIRECT CHARGE on the contractor's connected account. The contractor
// is merchant of record, funds never enter Green Bergen's balance, and the platform fee
// arrives as `application_fee_amount`.
//
// Amounts, the rail, and any retainage all come from stage_payment_quote, which reads
// the contract's agreed terms. This function decides nothing about money.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);

  // Runs as the CALLER: stage_payment_quote enforces can_view_project_financials,
  // so RLS decides whether this person may collect.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let body: { stage_id?: string; payment_method_id?: string; capture_method?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  if (!body.stage_id) return json({ error: "stage_id is required" }, 400);

  const { data: quote, error } = await supabase.rpc("stage_payment_quote", {
    p_stage_id: body.stage_id,
    p_payment_method_id: body.payment_method_id ?? null,
  });
  if (error) return json({ error: error.message }, 403);

  if (quote?.settlement_type !== "processor") {
    return json({
      error: "this milestone is set to a manual rail",
      detail: `${quote?.payment_method ?? "the chosen method"} is settled outside the app. Record it with the record_manual_payment RPC once the payment is made.`,
      rail: quote?.rail,
      method_source: quote?.method_source,
    }, 409);
  }
  if (quote?.provider !== "stripe") {
    return json({ error: `no adapter for provider ${quote?.provider}` }, 501);
  }
  if (!quote?.ok) return json({ error: "stage is not payable", blockers: quote?.blockers ?? [] }, 409);

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: Number(quote.amount_minor_units),
        currency: String(quote.currency),
        application_fee_amount: Number(quote.application_fee_minor) || undefined,
        capture_method: body.capture_method === "manual" ? "manual" : "automatic",
        description: `${quote.stage_name} - milestone payment`,
        metadata: {
          stage_id: String(quote.stage_id),
          project_id: String(quote.project_id),
          contract_id: String(quote.contract_id ?? ""),
          contractor_amount: String(quote.pay_contractor),
          platform_fee: String(quote.platform_fee_amount),
          fee_bearer: String(quote.fee_bearer),
          retainage_withheld: String(quote.retainage_withheld ?? 0),
          payment_method: String(quote.payment_method),
        },
      },
      {
        stripeAccount: String(quote.payee_account_ref), // DIRECT CHARGE
        idempotencyKey: body.idempotency_key ?? `stage-${quote.stage_id}-${quote.amount_minor_units}`,
      },
    );

    return json({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      connected_account_id: quote.payee_account_ref,
      breakdown: {
        milestone_value: quote.milestone_value,
        retainage_pct: quote.retainage_pct,
        retainage_withheld: quote.retainage_withheld,
        charge_payer: quote.charge_payer,
        pay_contractor: quote.pay_contractor,
        platform_fee: quote.platform_fee_amount,
        fee_collection: quote.fee_collection,
        fee_bearer: quote.fee_bearer,
        currency: quote.currency,
        rail: quote.rail,
        method_source: quote.method_source,
      },
    });
  } catch (e) {
    return json({ error: `stripe: ${(e as Error).message}` }, 502);
  }
});
