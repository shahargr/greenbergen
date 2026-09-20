// Puts a contractor on Stripe Connect so they can be paid on the card rail.
//
// This is ONE rail's onboarding. A contractor who only ever takes checks or Zelle
// needs no Stripe account at all - give them a payee_accounts row with the rail and
// a handle (the Zelle email, the payable-to name) and they are ready to be paid.
//
// Express accounts, because Stripe handles identity and bank collection and the
// contractor stays merchant of record on every direct charge. That is what keeps
// Green Bergen out of money transmission.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROVIDER = "stripe";

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let body: { contact_id?: string; project_id?: string; return_url?: string; refresh_url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  if (!body.contact_id || !body.project_id) {
    return json({ error: "contact_id and project_id are required" }, 400);
  }

  const { data: mayHire, error: permError } = await supabase.rpc("can_hire_on_project", {
    p_project_id: body.project_id,
  });
  if (permError) return json({ error: permError.message }, 403);
  if (!mayHire) return json({ error: "you do not have hiring rights on this project" }, 403);

  // RLS decides whether this contractor is even visible to the caller.
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, name, email_a")
    .eq("id", body.contact_id)
    .single();
  if (contactError || !contact) return json({ error: "contractor not found or not visible to you" }, 404);

  const { data: existing } = await supabase
    .from("payee_accounts")
    .select("id, external_account_id")
    .eq("contact_id", contact.id)
    .eq("provider", PROVIDER)
    .eq("rail", "card")
    .maybeSingle();

  try {
    let accountId = existing?.external_account_id as string | null | undefined;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: contact.email_a ?? undefined,
        business_profile: { name: contact.name ?? undefined },
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        metadata: { contact_id: String(contact.id) },
      });
      accountId = account.id;

      const { error: saveError } = await supabase.from("payee_accounts").insert({
        contact_id: contact.id,
        rail: "card",
        provider: PROVIDER,
        external_account_id: accountId,
        display_name: contact.name,
        status: "onboarding",
        payouts_enabled: false,
        is_default: true,
      });
      if (saveError) return json({ error: `could not save payee account: ${saveError.message}` }, 500);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: body.return_url ?? `${Deno.env.get("APP_BASE_URL") ?? "https://example.com"}/connect/done`,
      refresh_url: body.refresh_url ?? `${Deno.env.get("APP_BASE_URL") ?? "https://example.com"}/connect/retry`,
    });

    return json({ account_id: accountId, onboarding_url: link.url, expires_at: link.expires_at });
  } catch (e) {
    return json({ error: `stripe: ${(e as Error).message}` }, 502);
  }
});
