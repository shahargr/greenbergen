# Edge Functions

Recovered from the live project on 2026-09-20 and placed under version control.
They had been deployed since 2026-08-23 and existed in no repository - there was
no `supabase/` directory at all. Anything deployed is code; code belongs here.

## What they are

| Function | JWT | What it does |
|---|---|---|
| `stripe-webhook` | **off** | Stripe -> database. One provider's adapter, not the payment system. |
| `create-stage-payment` | on | Collects one milestone on a processor rail. Runs as the CALLER, so RLS decides. |
| `stripe-connect-onboarding` | on | Puts a contractor on Connect Express so they can take the card rail. |

`stripe-webhook` runs with `verify_jwt = false` on purpose: Stripe cannot send a
Supabase JWT, so the signature check inside the function IS the authentication.
Nothing in the body is trusted before it verifies.

## Secrets

Every secret is read from the environment - `Deno.env.get` - and no value is in
this repository. The names each function needs:

- `STRIPE_SECRET_KEY` - all three
- `STRIPE_WEBHOOK_SECRET` - `stripe-webhook`
- `SUPABASE_URL` - all three
- `SUPABASE_ANON_KEY` - the two that run as the caller
- `SUPABASE_SERVICE_ROLE_KEY` - `stripe-webhook` only, which has no caller to be
- `APP_BASE_URL` - `stripe-connect-onboarding`, for the return and refresh links

Set them in the Supabase dashboard. Per CLAUDE.md the service-role key is never
committed and is entered by Shahar.

## Deploying

    supabase functions deploy <slug>

`config.toml` beside this file carries `verify_jwt` per function, so a deploy
cannot quietly flip the webhook to requiring a JWT.

These are Deno, not the Next.js app: `Deno.serve`, `npm:` and `jsr:` specifiers.
The root `tsconfig.json` and `eslint.config.mjs` therefore exclude `supabase/`
the same way they exclude `apps/`. Without that the portal's typecheck fails on
every `Deno` reference and the Vercel build goes red.

## Where the rules actually live

These functions decide almost nothing. Amounts, the rail and any retainage come
from `stage_payment_quote`; both the processor path and the manual one converge
inside `settle_stage_internal`, so a milestone becomes rows in exactly one place
(rulebook 52). Read that section before changing anything here.
