# apps/shared

Code every Green Bergen app shares. Nothing here belongs to one app; if it
does, it lives in that app.

```
apps/shared/
├── src/
│   ├── styles/warm-ink.css   design system: tokens, components, the phone-column layout
│   ├── fonts.ts              Manrope via next/font/local (the variable file in ../fonts)
│   ├── ui.tsx                AppBar, Blueprint, Notice, StatusHero, NumberedNotes, icons…
│   ├── Illustrations.tsx     line illustrations keyed by blueprint_packages.illustration
│   ├── PriceBlock.tsx, ProgressLine.tsx, OfflineBanner.tsx
│   ├── catalogue.ts          package types, price maths, loader (database first, JSON fallback)
│   ├── catalogue.data.json   the launch catalogue - the single authoring source (see db/)
│   ├── progress.ts           the derived progress line, as homeowner_progress() returns it
│   ├── supabase/             keys, browser client, server client, proxy (session refresh)
│   ├── rpc.ts, format.ts, bergen.ts
├── fonts/                    the .woff2 files (OFL)
└── db/                       THE DATABASE CONTRACT for the consumer apps
    ├── 001_homeowner_schema.sql
    ├── 002_homeowner_seed.sql    generated: node db/gen-seed.mjs > db/002_homeowner_seed.sql
    ├── 003_homeowner_functions.sql   homeowner_* surface: me (homes, quota), book / plan / post, actions, share
    └── gen-seed.mjs
```

## How an app uses it

- The repo is one npm workspace (`"workspaces": ["apps/*"]` in the root
  `package.json`), so there is one `node_modules` at the repo root and a
  module means the same thing in every app. Install from the repo root.
- Each app aliases `@shared/*` to `../shared/src/*` in its `tsconfig.json`
  and sets `turbopack.root` / `outputFileTracingRoot` to the repo root in
  `next.config.ts`. See `apps/homeowner` for the pattern.
- Each app typechecks the shared sources it imports (its tsconfig `include`
  lists `../shared/src/**`). Lint runs here with `npm run lint`.

## Rules

- Shared means shared: no `/project` links, no homeowner-only copy, no
  contractor-only logic. Route-aware components stay in their app.
- The design system is edited here and nowhere else.
- `db/` is applied by Shahar, never automatically. Edit the catalogue in
  `src/catalogue.data.json`, regenerate the seed, then apply.
