// Run with the bundled Node: node test/browser/admin-test-server.mjs
// This server replaces every exported repository call and Supabase auth client.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../../", import.meta.url));
const repositoryPath = fileURLToPath(new URL("../../src/clubRepository.js", import.meta.url));
const repository = await readFile(repositoryPath, "utf8");
const names = [...repository.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((match) => match[1]);
const server = await createServer({
  configFile: false,
  root,
  cacheDir: "node_modules/.vite-admin-fixture",
  base: "/badminton-club/",
  envFile: false,
  server: { host: "127.0.0.1", port: 4188, strictPort: true },
  css: { postcss: {} },
  plugins: [{
    name: "isolated-admin-fixture",
    enforce: "pre",
    load(id) {
      if (id === repositoryPath) return `import { fixtureCall } from "/badminton-club/test/browser/admin-fixture-state.js";\n${names.map((name) => `export const ${name} = (...args) => fixtureCall(${JSON.stringify(name)}, args);`).join("\n")}`;
      if (id === fileURLToPath(new URL("../../src/supabase.js", import.meta.url))) return 'export { mockSupabase as supabase } from "/badminton-club/test/browser/admin-fixture-state.js"; export const isSupabaseConfigured = true;';
    },
  }, react()],
});
await server.listen();
server.printUrls();
