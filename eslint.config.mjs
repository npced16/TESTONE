import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/**", "dist/**", ".next/**", ".expo/**", "web-build/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ArrayBuffer: "readonly",
        Blob: "readonly",
        console: "readonly",
        document: "readonly",
        File: "readonly",
        FileReader: "readonly",
        fetch: "readonly",
        window: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly"
      }
    }
  },
  {
    files: ["babel.config.js", "metro.config.js"],
    languageOptions: {
      sourceType: "commonjs"
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    files: ["src/lib/insight.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  }
];
