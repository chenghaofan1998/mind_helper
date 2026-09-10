import { randomBytes } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import { createApiMiddleware } from "./server/api.js";
import { registryFromEnvironment } from "./server/sourceRegistry.js";

function knowledgeApi(): Plugin {
  const sessionToken = randomBytes(32).toString("base64url");
  return {
    name: "action-pocket-local-knowledge-api",
    transformIndexHtml(_html, context) {
      if (!context.server) return [];
      return [{
        tag: "meta",
        attrs: { name: "action-pocket-session-token", content: sessionToken },
        injectTo: "head",
      }];
    },
    configureServer(server) {
      const registry = registryFromEnvironment();
      server.middlewares.use(createApiMiddleware(registry, sessionToken));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [knowledgeApi()],
  build: { outDir: "web-dist" },
  server: { host: "127.0.0.1", port: 5173 },
});
