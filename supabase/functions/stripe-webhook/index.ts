// Stripe -> database. ONE provider's adapter, not the payment system itself.
//
// Stripe is one rail among several: checks, Zelle, Venmo, wire, cash and ACH are
// recorded through record_manual_payment. Both paths converge inside
// settle_stage_internal, so a milestone becomes rows in exactly one place.
//
// verify_jwt is OFF because Stripe cannot send a Supabase JWT. Authentication is
// the Stripe signature: nothing in the body is trusted before it verifies.
// Direct charges fire on the CONNECTED account, so events arrive with `account` set.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROVIDER = "stripe";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Which payment_methods row the ledger should record, based on what the payer used.
function methodNameFor(pi: Stripe.PaymentIntent): string {
  const details = (pi as unknown as { latest_charge?: { payment_method_details?: Record<string, unknown> } })
    .latest_charge?.payment_method_details;
  const wallet = (details as { card?: { wallet?: { type?: string } } })?.card?.wallet?.type;
  if (wallet === "apple_pay") return "Apple Pay (Stripe)";
  if (wallet === "google_pay") return "Google Pay (Stripe)";
  if ((details as { type?: string })?.type === "us_bank_account") return "Bank debit (Stripe ACH)";
  return String(pi.metadata?.payment_method ?? "Card (Stripe)");
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) return new Response("missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    return new Response(`signature verification failed: ${(e as Error).message}`, { status: 400 });
  }

  // Idempotency: unique index on (provider, provider_event_id) makes a replay a no-op.
  const { error: logError } = await admin.from("payment_provider_events").insert({
    provider: PROVIDER,
    provider_event_id: event.id,
    type: event.type,
    livemode: event.livemode,
    payload: event as unknown as Record<string, unknown>,
  });
  if (logError) {
    if (logError.code === "23505") return new Response("duplicate, already processed", { status: 200 });
    return new Response(`could not log event: ${logError.message}`, { status: 500 });
  }

  let processingError: string | null = null;

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.amount_capturable_updated":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const stageId = pi.metadata?.stage_id;
        if (!stageId) break; // not one of ours

        const status =
          event.type === "payment_intent.succeeded" ? "succeeded"
          : event.type === "payment_intent.amount_capturable_updated" ? "requires_capture"
          : event.type === "payment_intent.canceled" ? "canceled"
          : "failed";

        const fee = Number(pi.application_fee_amount ?? 0) / 100;
        const gross = Number(pi.amount) / 100;
        const contractorAmount = pi.metadata?.contractor_amount
          ? Number(pi.metadata.contractor_amount)
          : gross - fee;
        const retainage = Number(pi.metadata?.retainage_withheld ?? 0);
        const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;

        const { error } = await admin.rpc("record_stage_settlement", {
          p_stage_id: stageId,
          p_reference: pi.id,
          p_status: status,
          p_gross: gross,
          p_contractor: contractorAmount,
          p_fee: fee,
          p_currency: pi.currency,
          p_provider: PROVIDER,
          p_payee_account_ref: event.account ?? null,
          p_charge_reference: charge,
          p_fee_reference: null,
          p_failure_message: pi.last_payment_error?.message ?? null,
          p_payment_method: methodNameFor(pi),
          p_retainage: retainage,
        });
        if (error) processingError = error.message;
        break;
      }

      case "account.updated": {
        const acct = event.data.object as Stripe.Account;
        await admin.from("payee_accounts").update({
          payouts_enabled: Boolean(acct.payouts_enabled),
          status: acct.payouts_enabled
            ? "enabled"
            : (acct.requirements?.disabled_reason ? "restricted" : "onboarding"),
          verified_at: acct.payouts_enabled ? new Date().toISOString() : null,
          last_modified_at: new Date().toISOString(),
        }).eq("external_account_id", acct.id).eq("provider", PROVIDER);
        break;
      }

      case "charge.refunded": {
        const ch = event.data.object as Stripe.Charge;
        const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
        if (pi) {
          await admin.from("stage_settlements")
            .update({ status: "refunded", last_modified_at: new Date().toISOString() })
            .eq("provider_reference", pi).eq("provider", PROVIDER);
        }
        break;
      }
    }
  } catch (e) {
    processingError = (e as Error).message;
  }

  await admin.from("payment_provider_events")
    .update({ processed_at: new Date().toISOString(), processing_error: processingError })
    .eq("provider", PROVIDER).eq("provider_event_id", event.id);

  // Always 200 on a verified event we have recorded - a 500 makes Stripe retry
  // an event we already stored, and the error is visible in payment_provider_events.
  return new Response(processingError ? `recorded with error: ${processingError}` : "ok", { status: 200 });
});
