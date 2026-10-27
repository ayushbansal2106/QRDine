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
  ]),
  {
    rules: {
      /**
       * `no-explicit-any` stays an ERROR. It was briefly downgraded to a
       * warning with a "ratchet" script to make CI green; that was a bypass,
       * not a fix, and it has been reverted.
       *
       * The 309 violations are real type holes — almost all of them untyped
       * API responses — and the fix is to type the boundary once and let it
       * propagate, not to silence the rule. `scripts/lint-report.mjs` remains
       * useful as a progress tracker, but it is not a gate and does not
       * stand in for typing the code.
       */
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);

export default eslintConfig;
