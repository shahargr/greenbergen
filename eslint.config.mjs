import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested apps lint themselves (apps/homeowner has its own config).
    "apps/**",
    // Deno sources for the Supabase Edge Functions - not part of this app.
    "supabase/**",
  ]),
]);

export default eslintConfig;
