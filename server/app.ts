import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createApiMiddleware } from "./api.js";
import { registryFromEnvironment, type SourceRegistry } from "./sourceRegistry.js";

interface StandaloneOptions {
  documentRoot: string;
  registry: Promise<SourceRegistry>;
  sessionToken?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function safePath(root: string, pathname: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  const candidate = resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..") ? candidate : undefined;
}

function secureHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

async function sendStatic(request: IncomingMessage, response: ServerResponse, root: string, token: string): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.end("Method Not Allowed");
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const file = safePath(root, pathname);
  if (!file) {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    secureHeaders(response);
    response.setHeader("Content-Type", MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    const body = await readFile(file);
    const output = file.endsWith("index.html")
      ? Buffer.from(body.toString("utf8").replace("</head>", `<meta name="action-pocket-session-token" content="${token}"></head>`))
      : body;
    response.statusCode = 200;
    response.setHeader("Content-Length", output.length);
    response.end(request.method === "HEAD" ? undefined : output);
  } catch {
    response.statusCode = 404;
    response.end("Not Found");
  }
}

export function createStandaloneServer(options: StandaloneOptions): { server: Server; sessionToken: string } {
  const documentRoot = resolve(options.documentRoot);
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url");
  const api = createApiMiddleware(options.registry, sessionToken);
  const server = createServer((request, response) => {
    void api(request, response, () => { void sendStatic(request, response, documentRoot, sessionToken); });
  });
  return { server, sessionToken };
}

async function run(): Promise<void> {
  const port = Number(process.env.AP_PORT ?? "43127");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("AP_PORT 必须是 1–65535 的整数。");
  const { server } = createStandaloneServer({
    documentRoot: resolve(process.cwd(), "web-dist"),
    registry: registryFromEnvironment(),
  });
  server.listen(port, "127.0.0.1", () => console.log(`Action Pocket 已启动：http://127.0.0.1:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entry === import.meta.url) run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
