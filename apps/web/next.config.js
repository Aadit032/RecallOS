import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bun monorepo: Turbopack's PostCSS runner can't always resolve
  // workspace-local plugins — pin the absolute path.
  turbopack: {
    resolveAlias: {
      "@tailwindcss/postcss": path.join(
        __dirname,
        "node_modules/@tailwindcss/postcss"
      ),
    },
  },
};

export default nextConfig;
