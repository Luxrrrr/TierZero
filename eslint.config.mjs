import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      ".worktrees/**",
      "**/*.d.ts",
      "packages/db/prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase uses leading-underscore names for arguments it has to
      // accept but does not read, which is the convention the router and the
      // event handlers are written against.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The shared packages hold the rules and shapes the bot, a module and the
    // dashboard all agree on. The dashboard loads them, so they must not reach
    // for Discord or the database.
    files: ["packages/shared/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["discord.js", "discord.js/*"], message: "Shared packages are loaded by the dashboard and must not depend on discord.js." },
            { group: ["@tier0/db", "@prisma/client"], message: "Shared packages are loaded by the dashboard and must not touch the database." },
          ],
        },
      ],
    },
  },
  {
    // Tests reach into built output and stub discord.js objects, so the
    // assertions that keep them readable are worth more here than the rule.
    files: ["**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },
);
