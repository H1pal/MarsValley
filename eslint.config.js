import js from "@eslint/js";

export default [
  { ignores: ["dist/**", "artifacts/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: Object.fromEntries(
        [
          "document",
          "window",
          "localStorage",
          "navigator",
          "requestAnimationFrame",
          "performance",
          "console",
          "setTimeout",
          "clearTimeout",
          "URL",
          "process",
          "structuredClone",
          "TextEncoder",
          "Buffer",
          "setInterval",
          "clearInterval",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
];
