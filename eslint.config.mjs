import { readdirSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * Fronteras del monolito modular (ver docs/ARQUITECTURA.md):
 *   app (rutas)  ->  shell  ->  modules/*  ->  components (UI kit)  ->  lib (kernel)
 * Un módulo solo consume de otro su superficie pública: api.ts, types.ts y actions.ts.
 * Sus componentes y esquemas son internos.
 */
const MODULES = readdirSync(new URL("./src/modules", import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const layer = (files, group, message) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns: [{ group, message }] }] },
});

const moduleBoundaries = MODULES.map((mod) => {
  const others = MODULES.filter((m) => m !== mod);
  return {
    files: [`src/modules/${mod}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: others.flatMap((m) => [`@/modules/${m}/components/**`, `@/modules/${m}/schema`]),
              message: "Un módulo solo usa la superficie pública de otro (api, types, actions).",
            },
            { group: ["@/shell/**", "@/app/**"], message: "Los módulos no dependen del shell ni de las rutas." },
            { group: ["../../*"], message: "Usa el alias @/ para salir del módulo." },
          ],
        },
      ],
    },
  };
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  layer(["src/lib/**/*.{ts,tsx}"], ["@/modules/**", "@/components/**", "@/shell/**", "@/app/**"], "El kernel (lib) no depende de capas superiores."),
  layer(["src/components/**/*.{ts,tsx}"], ["@/modules/**", "@/shell/**", "@/app/**"], "El kit de UI es genérico: no conoce módulos, shell ni rutas."),
  layer(["src/shell/**/*.{ts,tsx}"], ["@/app/**", "@/modules/*/components/**", "@/modules/*/schema"], "El shell solo usa la superficie pública de los módulos."),
  ...moduleBoundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
